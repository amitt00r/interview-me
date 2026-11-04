package com.mockinterviewer.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.mockinterviewer.ai.AiProvider;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.BindException;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;

/** Binds {@code app.ai.*} through Spring's real binder, the way application.yml is bound. */
class AiPropertiesTest {

    private static AiProperties bind(Map<String, String> props) {
        return new Binder(new MapConfigurationPropertySource(props))
                .bind("app.ai", AiProperties.class)
                .get();
    }

    @Test
    void providerSelectsTheAnthropicBlock() {
        AiProperties props = bind(Map.of(
                "app.ai.max-questions", "5",
                "app.ai.provider", "anthropic",
                "app.ai.anthropic.api-key", "sk-ant",
                "app.ai.anthropic.turn-effort", "low",
                "app.ai.openai.api-key", "sk-openai"));

        assertThat(props.maxQuestions()).isEqualTo(5);
        assertThat(props.selected()).isEqualTo(new AiProviderSettings.Anthropic(
                "sk-ant", null, AiProviderSettings.Anthropic.DEFAULT_MODEL, "low", null));
    }

    @Test
    void providerSelectsTheOpenAiBlockWithItsOwnKeys() {
        AiProperties props = bind(Map.of(
                "app.ai.provider", "openai",
                "app.ai.openai.organization", "org-1",
                "app.ai.openai.base-url", "http://localhost:11434/v1",
                "app.ai.openai.model", ""));

        assertThat(props.selected()).isInstanceOfSatisfying(AiProviderSettings.OpenAi.class, s -> {
            assertThat(s.organization()).isEqualTo("org-1");
            assertThat(s.baseUrl()).isEqualTo("http://localhost:11434/v1");
            assertThat(s.model()).isEqualTo(AiProviderSettings.OpenAi.DEFAULT_MODEL);
        });
    }

    @Test
    void missingProviderAndBlocksDefaultToAnthropic() {
        AiProperties props = bind(Map.of("app.ai.max-questions", "5"));

        assertThat(props.selected()).isEqualTo(new AiProviderSettings.Anthropic(
                null, null, AiProviderSettings.Anthropic.DEFAULT_MODEL, null, null));
    }

    @Test
    void unknownProviderFailsAtStartup() {
        assertThatThrownBy(() -> bind(Map.of("app.ai.provider", "gemini")))
                .isInstanceOf(BindException.class);
    }

    @Test
    void eachProviderFailsFastWithItsOwnMessageWhenTheKeyIsMissing() {
        assumeTrue(System.getenv("ANTHROPIC_API_KEY") == null, "ANTHROPIC_API_KEY is set in this environment");
        assumeTrue(System.getenv("OPENAI_API_KEY") == null, "OPENAI_API_KEY is set in this environment");

        assertThatThrownBy(() -> new AiProviderSettings.Anthropic(null, null, null, null, null).createProvider())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("ANTHROPIC_API_KEY").hasMessageContaining("app.ai.anthropic.api-key");
        assertThatThrownBy(() -> new AiProviderSettings.OpenAi("", null, null, null, null, null).createProvider())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("OPENAI_API_KEY").hasMessageContaining("app.ai.openai.api-key");
    }

    @Test
    void eachProviderBuildsItsOwnImplementation() {
        AiProvider anthropic = new AiProviderSettings.Anthropic("k", null, null, null, null).createProvider();
        AiProvider openai = new AiProviderSettings.OpenAi("k", "http://localhost:1/v1", "org", null, null, null)
                .createProvider();

        assertThat(anthropic.displayName()).isEqualTo("Claude");
        assertThat(openai.displayName()).isEqualTo("OpenAI");
    }
}
