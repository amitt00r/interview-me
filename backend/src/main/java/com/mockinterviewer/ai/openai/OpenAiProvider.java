package com.mockinterviewer.ai.openai;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mockinterviewer.ai.AiProvider;
import com.mockinterviewer.common.AiResponseException;
import com.mockinterviewer.config.AiProviderSettings;
import com.openai.client.OpenAIClient;
import com.openai.core.JsonValue;
import com.openai.models.FunctionDefinition;
import com.openai.models.FunctionParameters;
import com.openai.models.ReasoningEffort;
import com.openai.models.chat.completions.ChatCompletion;
import com.openai.models.chat.completions.ChatCompletion.Choice.FinishReason;
import com.openai.models.chat.completions.ChatCompletionContentPart;
import com.openai.models.chat.completions.ChatCompletionContentPartImage;
import com.openai.models.chat.completions.ChatCompletionContentPartText;
import com.openai.models.chat.completions.ChatCompletionCreateParams;
import com.openai.models.chat.completions.ChatCompletionFunctionTool;
import com.openai.models.chat.completions.ChatCompletionMessage;
import com.openai.models.chat.completions.ChatCompletionMessageFunctionToolCall;
import com.openai.models.chat.completions.ChatCompletionMessageParam;
import com.openai.models.chat.completions.ChatCompletionMessageToolCall;
import com.openai.models.chat.completions.ChatCompletionSystemMessageParam;
import com.openai.models.chat.completions.ChatCompletionTool;
import com.openai.models.chat.completions.ChatCompletionToolMessageParam;
import com.openai.models.chat.completions.ChatCompletionUserMessageParam;
import com.openai.models.chat.completions.StructuredChatCompletion;
import com.openai.models.chat.completions.StructuredChatCompletionCreateParams;
import com.openai.models.completions.CompletionUsage;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * OpenAI (or any OpenAI-compatible server, via {@code base-url}) through the Chat Completions API: structured
 * outputs from the {@code AiOutputs} records, PDFs as base64 file parts, images as data URLs. OpenAI caches long
 * prompt prefixes automatically, so the cache breakpoint is ignored. The effort settings are sent as
 * {@code reasoning_effort}; leave them blank for models that don't reason.
 */
public class OpenAiProvider implements AiProvider {

    private static final long MAX_TOKENS = 16000L;
    private static final ObjectMapper JSON = new ObjectMapper();

    private static final Logger log = LoggerFactory.getLogger(OpenAiProvider.class);

    private final OpenAIClient client;
    private final AiProviderSettings settings;

    public OpenAiProvider(OpenAIClient client, AiProviderSettings settings) {
        this.client = client;
        this.settings = settings;
    }

    @Override
    public String displayName() {
        return "OpenAI";
    }

    @Override
    public String apiKeyVariable() {
        return "OPENAI_API_KEY";
    }

    @Override
    public <T> T structured(Class<T> type, Effort effort, String system, List<Content> content, String label) {
        StructuredChatCompletionCreateParams.Builder<T> params = ChatCompletionCreateParams.builder()
                .model(settings.model())
                .maxCompletionTokens(MAX_TOKENS)
                .addSystemMessage(system)
                .addUserMessageOfArrayOfContentParts(content.stream().map(OpenAiProvider::part).toList())
                .responseFormat(type);
        reasoningEffort(effort).ifPresent(params::reasoningEffort);

        long startedNanos = System.nanoTime();
        StructuredChatCompletion<T> response = client.chat().completions().create(params.build());
        if (response.choices().isEmpty()) {
            throw new AiResponseException("The AI returned no usable output.");
        }
        var choice = response.choices().getFirst();
        FinishReason finish = choice.finishReason();
        logCall(label, startedNanos, response.usage(), finish);

        if (choice.message().refusal().filter(r -> !r.isBlank()).isPresent()
                || FinishReason.CONTENT_FILTER.equals(finish)) {
            throw new AiResponseException("The AI declined to continue this interview.");
        }
        if (FinishReason.LENGTH.equals(finish)) {
            throw new AiResponseException("The AI response was cut off. Please try again.");
        }
        try {
            return choice.message().content()
                    .orElseThrow(() -> new AiResponseException("The AI returned no usable output."));
        } catch (AiResponseException e) {
            throw e;
        } catch (RuntimeException e) {
            log.warn("Could not parse {} output: {}", label, e.getMessage());
            throw new AiResponseException("The AI returned output in an unexpected shape. Please try again.");
        }
    }

    @Override
    public Chat newChat(String system, List<Tool> tools) {
        return new OpenAiChat(system, tools.stream().map(OpenAiProvider::toolParam).toList());
    }

    private Optional<ReasoningEffort> reasoningEffort(Effort effort) {
        String value = effort == Effort.TURN ? settings.turnEffort() : settings.finalEffort();
        return value == null || value.isBlank() ? Optional.empty() : Optional.of(ReasoningEffort.of(value));
    }

    private void logCall(String label, long startedNanos, Optional<CompletionUsage> usage, FinishReason finish) {
        log.info("OpenAI {} took {} ms ({} in / {} out tokens, finish {})", label,
                (System.nanoTime() - startedNanos) / 1_000_000,
                usage.map(CompletionUsage::promptTokens).orElse(0L),
                usage.map(CompletionUsage::completionTokens).orElse(0L),
                finish);
    }

    private static ChatCompletionContentPart part(Content content) {
        return switch (content) {
            case Text(String text, boolean ignoredBreakpoint) -> textPart(text);
            case Document(String title, byte[] data, boolean pdf) -> pdf
                    ? ChatCompletionContentPart.ofFile(ChatCompletionContentPart.File.builder()
                            .file(ChatCompletionContentPart.File.FileObject.builder()
                                    .filename(title.replaceAll("[^A-Za-z0-9._-]+", "-") + ".pdf")
                                    .fileData("data:application/pdf;base64," + Base64.getEncoder().encodeToString(data))
                                    .build())
                            .build())
                    : textPart("<document title=\"" + title + "\">\n"
                            + new String(data, StandardCharsets.UTF_8) + "\n</document>\n\n");
            case Image(byte[] png) -> ChatCompletionContentPart.ofImageUrl(ChatCompletionContentPartImage.builder()
                    .imageUrl(ChatCompletionContentPartImage.ImageUrl.builder()
                            .url("data:image/png;base64," + Base64.getEncoder().encodeToString(png))
                            .build())
                    .build());
        };
    }

    private static ChatCompletionContentPart textPart(String text) {
        return ChatCompletionContentPart.ofText(ChatCompletionContentPartText.builder().text(text).build());
    }

    private static ChatCompletionTool toolParam(Tool tool) {
        FunctionParameters.Builder parameters = FunctionParameters.builder();
        tool.inputSchema().forEach((key, value) -> parameters.putAdditionalProperty(key, JsonValue.from(value)));
        parameters.putAdditionalProperty("additionalProperties", JsonValue.from(false));
        return ChatCompletionTool.ofFunction(ChatCompletionFunctionTool.builder()
                .function(FunctionDefinition.builder()
                        .name(tool.name())
                        .description(tool.description())
                        .parameters(parameters.build())
                        .build())
                .build());
    }

    private final class OpenAiChat implements Chat {

        private final List<ChatCompletionTool> tools;
        private final List<ChatCompletionMessageParam> messages = new ArrayList<>();

        OpenAiChat(String system, List<ChatCompletionTool> tools) {
            this.tools = tools;
            messages.add(ChatCompletionMessageParam.ofSystem(
                    ChatCompletionSystemMessageParam.builder().content(system).build()));
        }

        @Override
        public void addUserMessage(String text) {
            messages.add(ChatCompletionMessageParam.ofUser(
                    ChatCompletionUserMessageParam.builder().content(text).build()));
        }

        @Override
        public void addToolResults(List<ToolOutcome> results) {
            for (ToolOutcome r : results) {
                messages.add(ChatCompletionMessageParam.ofTool(ChatCompletionToolMessageParam.builder()
                        .toolCallId(r.toolCallId())
                        .content(r.error() ? "Error: " + r.text() : r.text())
                        .build()));
            }
        }

        @Override
        public ChatStep send(Effort effort) {
            ChatCompletionCreateParams.Builder params = ChatCompletionCreateParams.builder()
                    .model(settings.model())
                    .maxCompletionTokens(MAX_TOKENS)
                    .messages(messages)
                    .tools(tools);
            reasoningEffort(effort).ifPresent(params::reasoningEffort);

            long started = System.nanoTime();
            ChatCompletion response = client.chat().completions().create(params.build());
            if (response.choices().isEmpty()) {
                throw new AiResponseException("The AI returned no usable output.");
            }
            ChatCompletion.Choice choice = response.choices().getFirst();
            FinishReason finish = choice.finishReason();
            logCall("chat call", started, response.usage(), finish);
            if (FinishReason.LENGTH.equals(finish)) {
                throw new AiResponseException("The reply was cut off. Please try again.");
            }
            ChatCompletionMessage message = choice.message();
            messages.add(ChatCompletionMessageParam.ofAssistant(message.toParam()));

            boolean refused = message.refusal().filter(r -> !r.isBlank()).isPresent()
                    || FinishReason.CONTENT_FILTER.equals(finish);
            List<ToolCall> calls = message.toolCalls().orElse(List.of()).stream()
                    .filter(ChatCompletionMessageToolCall::isFunction)
                    .map(ChatCompletionMessageToolCall::asFunction)
                    .map(OpenAiChat::toolCall)
                    .toList();
            return new ChatStep(message.content().orElse("").strip(), calls, refused);
        }

        @Override
        public int checkpoint() {
            return messages.size();
        }

        @Override
        public void rollback(int checkpoint) {
            messages.subList(Math.max(1, checkpoint), messages.size()).clear();
        }

        private static ToolCall toolCall(ChatCompletionMessageFunctionToolCall call) {
            Map<String, Object> args;
            try {
                String raw = call.function().arguments();
                args = raw == null || raw.isBlank() ? Map.of()
                        : JSON.readValue(raw, new TypeReference<LinkedHashMap<String, Object>>() {
                        });
            } catch (Exception e) {
                throw new AiResponseException("The AI sent malformed tool arguments. Please try again.");
            }
            return new ToolCall(call.id(), call.function().name(), args == null ? Map.of() : args);
        }
    }
}
