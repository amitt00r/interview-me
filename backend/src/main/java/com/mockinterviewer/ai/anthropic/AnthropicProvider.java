package com.mockinterviewer.ai.anthropic;

import com.anthropic.client.AnthropicClient;
import com.anthropic.core.JsonValue;
import com.anthropic.models.messages.Base64ImageSource;
import com.anthropic.models.messages.Base64PdfSource;
import com.anthropic.models.messages.CacheControlEphemeral;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.DocumentBlockParam;
import com.anthropic.models.messages.ImageBlockParam;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.MessageParam;
import com.anthropic.models.messages.OutputConfig;
import com.anthropic.models.messages.PlainTextSource;
import com.anthropic.models.messages.StopReason;
import com.anthropic.models.messages.StructuredMessage;
import com.anthropic.models.messages.StructuredMessageCreateParams;
import com.anthropic.models.messages.StructuredOutputConfig;
import com.anthropic.models.messages.StructuredTextBlock;
import com.anthropic.models.messages.TextBlock;
import com.anthropic.models.messages.TextBlockParam;
import com.anthropic.models.messages.ToolResultBlockParam;
import com.anthropic.models.messages.ToolUnion;
import com.anthropic.models.messages.ToolUseBlock;
import com.fasterxml.jackson.core.type.TypeReference;
import com.mockinterviewer.ai.AiProvider;
import com.mockinterviewer.common.AiResponseException;
import com.mockinterviewer.config.AiProviderSettings;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Claude via the Anthropic Messages API: structured outputs, explicit prompt caching at the setup breakpoint, and
 * server-side refusal fallback ({@code fallbacks: "default"} + beta header). Chats store each response with
 * {@code toParam()} so thinking blocks replay unchanged.
 */
public class AnthropicProvider implements AiProvider {

    /** Server-side refusal fallback: a declined request is retried on Anthropic's recommended model. */
    private static final String FALLBACK_BETA = "server-side-fallback-2026-07-01";
    private static final long MAX_TOKENS = 16000L;

    private static final Logger log = LoggerFactory.getLogger(AnthropicProvider.class);

    private final AnthropicClient client;
    private final AiProviderSettings settings;

    public AnthropicProvider(AnthropicClient client, AiProviderSettings settings) {
        this.client = client;
        this.settings = settings;
    }

    @Override
    public String displayName() {
        return "Claude";
    }

    @Override
    public String apiKeyVariable() {
        return "ANTHROPIC_API_KEY";
    }

    @Override
    public <T> T structured(Class<T> type, Effort effort, String system, List<Content> content, String label) {
        StructuredOutputConfig.Builder<T> output = StructuredOutputConfig.<T>builder().format(type);
        String effortValue = effortValue(effort);
        if (effortValue != null) {
            output.effort(OutputConfig.Effort.of(effortValue));
        }
        StructuredMessageCreateParams<T> params = MessageCreateParams.builder()
                .model(settings.model())
                .maxTokens(MAX_TOKENS)
                .systemOfTextBlockParams(List.of(TextBlockParam.builder().text(system).build()))
                .outputConfig(output.build())
                .addUserMessageOfContentBlockParams(content.stream().map(AnthropicProvider::block).toList())
                .putAdditionalHeader("anthropic-beta", FALLBACK_BETA)
                .putAdditionalBodyProperty("fallbacks", JsonValue.from("default"))
                .build();

        long startedNanos = System.nanoTime();
        StructuredMessage<T> response = client.messages().create(params);
        log.info("Claude {} took {} ms ({} in / {} out tokens, stop {})", label,
                (System.nanoTime() - startedNanos) / 1_000_000,
                response.usage().inputTokens(), response.usage().outputTokens(),
                response.stopReason().map(Object::toString).orElse("none"));

        StopReason stop = response.stopReason().orElse(null);
        if (StopReason.REFUSAL.equals(stop)) {
            throw new AiResponseException("The AI declined to continue this interview.");
        }
        if (StopReason.MAX_TOKENS.equals(stop)) {
            throw new AiResponseException("The AI response was cut off. Please try again.");
        }
        return response.content().stream()
                .flatMap(block -> block.text().stream())
                .map(StructuredTextBlock::text)
                .findFirst()
                .orElseThrow(() -> new AiResponseException("The AI returned no usable output."));
    }

    @Override
    public Chat newChat(String system, List<Tool> tools) {
        return new AnthropicChat(system, tools.stream().map(AnthropicProvider::toolParam).toList());
    }

    private String effortValue(Effort effort) {
        String value = effort == Effort.TURN ? settings.turnEffort() : settings.finalEffort();
        return value == null || value.isBlank() ? null : value;
    }

    private static ContentBlockParam block(Content part) {
        return switch (part) {
            case Text(String text, boolean cacheBreakpoint) -> {
                TextBlockParam.Builder b = TextBlockParam.builder().text(text);
                if (cacheBreakpoint) {
                    b.cacheControl(CacheControlEphemeral.builder().build());
                }
                yield ContentBlockParam.ofText(b.build());
            }
            case Document(String title, byte[] data, boolean pdf) -> {
                DocumentBlockParam.Builder doc = DocumentBlockParam.builder().title(title);
                if (pdf) {
                    doc.source(Base64PdfSource.builder().data(Base64.getEncoder().encodeToString(data)).build());
                } else {
                    doc.source(PlainTextSource.builder().data(new String(data, StandardCharsets.UTF_8)).build());
                }
                yield ContentBlockParam.ofDocument(doc.build());
            }
            case Image(byte[] png) -> ContentBlockParam.ofImage(ImageBlockParam.builder()
                    .source(Base64ImageSource.builder()
                            .mediaType(Base64ImageSource.MediaType.IMAGE_PNG)
                            .data(Base64.getEncoder().encodeToString(png))
                            .build())
                    .build());
        };
    }

    private static com.anthropic.models.messages.Tool toolParam(Tool tool) {
        @SuppressWarnings("unchecked")
        Map<String, Object> properties = (Map<String, Object>) tool.inputSchema().get("properties");
        @SuppressWarnings("unchecked")
        List<String> required = (List<String>) tool.inputSchema().get("required");
        var props = com.anthropic.models.messages.Tool.InputSchema.Properties.builder();
        if (properties != null) {
            properties.forEach((name, schema) -> props.putAdditionalProperty(name, JsonValue.from(schema)));
        }
        return com.anthropic.models.messages.Tool.builder()
                .name(tool.name())
                .description(tool.description())
                .inputSchema(com.anthropic.models.messages.Tool.InputSchema.builder()
                        .properties(props.build())
                        .required(required == null ? List.of() : required)
                        .putAdditionalProperty("additionalProperties", JsonValue.from(false))
                        .build())
                .build();
    }

    private final class AnthropicChat implements Chat {

        private final String system;
        private final List<ToolUnion> tools;
        private final List<MessageParam> messages = new ArrayList<>();

        AnthropicChat(String system, List<com.anthropic.models.messages.Tool> tools) {
            this.system = system;
            this.tools = tools.stream().map(ToolUnion::ofTool).toList();
        }

        @Override
        public void addUserMessage(String text) {
            messages.add(MessageParam.ofUser(text));
        }

        @Override
        public void addToolResults(List<ToolOutcome> results) {
            messages.add(MessageParam.ofUserOfContentBlockParams(results.stream()
                    .map(r -> ContentBlockParam.ofToolResult(ToolResultBlockParam.builder()
                            .toolUseId(r.toolCallId())
                            .content(r.text())
                            .isError(r.error())
                            .build()))
                    .toList()));
        }

        @Override
        public ChatStep send(Effort effort) {
            MessageCreateParams.Builder params = MessageCreateParams.builder()
                    .model(settings.model())
                    .maxTokens(MAX_TOKENS)
                    .system(system)
                    .tools(tools)
                    .messages(messages)
                    .putAdditionalHeader("anthropic-beta", FALLBACK_BETA)
                    .putAdditionalBodyProperty("fallbacks", JsonValue.from("default"));
            String effortValue = effortValue(effort);
            if (effortValue != null) {
                params.outputConfig(OutputConfig.builder().effort(OutputConfig.Effort.of(effortValue)).build());
            }
            long started = System.nanoTime();
            Message response = client.messages().create(params.build());
            log.info("Claude chat call took {} ms ({} in / {} out tokens, stop {})",
                    (System.nanoTime() - started) / 1_000_000,
                    response.usage().inputTokens(), response.usage().outputTokens(),
                    response.stopReason().map(Object::toString).orElse("none"));
            StopReason stop = response.stopReason().orElse(null);
            if (StopReason.MAX_TOKENS.equals(stop)) {
                throw new AiResponseException("The reply was cut off. Please try again.");
            }
            messages.add(response.toParam());

            String text = response.content().stream()
                    .flatMap(block -> block.text().stream())
                    .map(TextBlock::text)
                    .collect(Collectors.joining("\n\n"))
                    .strip();
            List<ToolCall> calls = StopReason.TOOL_USE.equals(stop)
                    ? response.content().stream()
                            .flatMap(block -> block.toolUse().stream())
                            .map(AnthropicChat::toolCall)
                            .toList()
                    : List.of();
            return new ChatStep(text, calls, StopReason.REFUSAL.equals(stop));
        }

        @Override
        public int checkpoint() {
            return messages.size();
        }

        @Override
        public void rollback(int checkpoint) {
            messages.subList(checkpoint, messages.size()).clear();
        }

        private static ToolCall toolCall(ToolUseBlock call) {
            Map<String, Object> args = call._input().convert(new TypeReference<LinkedHashMap<String, Object>>() {
            });
            return new ToolCall(call.id(), call.name(), args == null ? Map.of() : args);
        }
    }
}
