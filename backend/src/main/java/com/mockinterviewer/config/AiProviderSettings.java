package com.mockinterviewer.config;

import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.mockinterviewer.ai.AiProvider;
import com.mockinterviewer.ai.anthropic.AnthropicProvider;
import com.mockinterviewer.ai.openai.OpenAiProvider;
import com.openai.client.okhttp.OpenAIOkHttpClient;

/**
 * One AI provider's settings: {@link Anthropic} is bound from {@code app.ai.anthropic.*} and {@link OpenAi} from
 * {@code app.ai.openai.*}; {@code app.ai.provider} selects which one is used (see {@link AiProperties}). Each is
 * self-contained: it holds only the values its provider understands, fills in its own defaults, validates them and
 * builds its own {@link AiProvider}, failing startup with its own message when something required is missing.
 * Blank values count as unset.
 */
public sealed interface AiProviderSettings {

    /** API key; when blank the provider falls back to its SDK's own environment variable. */
    String apiKey();

    /** API base URL; blank uses the provider's public endpoint. */
    String baseUrl();

    String model();

    /** Effort for per-answer calls and Nikolai (latency sensitive); blank sends none. */
    String turnEffort();

    /** Effort for planning, the final evaluation and study guides; blank sends none. */
    String finalEffort();

    /**
     * Validates these settings and builds the provider.
     *
     * @throws IllegalStateException when a required value (such as the API key) is missing, so the app fails at
     *                               startup with a message saying what to set
     */
    AiProvider createProvider();

    /** Claude via the Anthropic API. Efforts: low, medium, high, max. */
    record Anthropic(String apiKey, String baseUrl, String model, String turnEffort, String finalEffort)
            implements AiProviderSettings {

        public static final String DEFAULT_MODEL = "claude-opus-5-5";
        private static final String KEY_VARIABLE = "ANTHROPIC_API_KEY";

        public Anthropic {
            model = orDefault(model, DEFAULT_MODEL);
        }

        @Override
        public AiProvider createProvider() {
            if (isBlank(apiKey) && isBlank(System.getenv(KEY_VARIABLE))) {
                throw new IllegalStateException("The Anthropic AI provider needs an API key: set " + KEY_VARIABLE
                        + " (or app.ai.anthropic.api-key). Get one at https://console.anthropic.com/.");
            }
            AnthropicOkHttpClient.Builder client = AnthropicOkHttpClient.builder().fromEnv();
            if (!isBlank(apiKey)) {
                client.apiKey(apiKey);
            }
            if (!isBlank(baseUrl)) {
                client.baseUrl(baseUrl);
            }
            return new AnthropicProvider(client.build(), this);
        }
    }

    /**
     * OpenAI, or any OpenAI-compatible server via {@code base-url}. Efforts are sent as {@code reasoning_effort};
     * leave them blank for models that don't reason. {@code organization} is optional (the SDK also reads
     * {@code OPENAI_ORG_ID}).
     */
    record OpenAi(String apiKey, String baseUrl, String organization, String model, String turnEffort,
            String finalEffort) implements AiProviderSettings {

        public static final String DEFAULT_MODEL = "gpt-5.1";
        private static final String KEY_VARIABLE = "OPENAI_API_KEY";

        public OpenAi {
            model = orDefault(model, DEFAULT_MODEL);
        }

        @Override
        public AiProvider createProvider() {
            if (isBlank(apiKey) && isBlank(System.getenv(KEY_VARIABLE))) {
                throw new IllegalStateException("The OpenAI AI provider needs an API key: set " + KEY_VARIABLE
                        + " (or app.ai.openai.api-key). OpenAI-compatible servers that don't check keys "
                        + "still need a placeholder value.");
            }
            OpenAIOkHttpClient.Builder client = OpenAIOkHttpClient.builder().fromEnv();
            if (!isBlank(apiKey)) {
                client.apiKey(apiKey);
            }
            if (!isBlank(baseUrl)) {
                client.baseUrl(baseUrl);
            }
            if (!isBlank(organization)) {
                client.organization(organization);
            }
            return new OpenAiProvider(client.build(), this);
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static String orDefault(String value, String fallback) {
        return isBlank(value) ? fallback : value;
    }
}
