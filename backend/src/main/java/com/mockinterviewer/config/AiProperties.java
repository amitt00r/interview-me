package com.mockinterviewer.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Settings for the AI-backed interview engine, bound from {@code app.ai.*}.
 *
 * @param provider      which provider runs interviews and Nikolai ({@code anthropic} or {@code openai})
 * @param maxQuestions  main (non follow-up) questions per interview
 * @param maxFollowUps  follow-ups allowed on a single main question
 * @param panelSize     interviewers assigned to a panel interview
 * @param anthropic     {@code app.ai.anthropic.*}, used when {@code provider} is {@code anthropic}
 * @param openai        {@code app.ai.openai.*}, used when {@code provider} is {@code openai}
 */
@ConfigurationProperties(prefix = "app.ai")
public record AiProperties(
        @DefaultValue("anthropic") Provider provider,
        int maxQuestions,
        int maxFollowUps,
        int panelSize,
        @DefaultValue AiProviderSettings.Anthropic anthropic,
        @DefaultValue AiProviderSettings.OpenAi openai) {

    public enum Provider {
        ANTHROPIC,
        OPENAI
    }

    /** The settings block of the selected provider. */
    public AiProviderSettings selected() {
        return switch (provider) {
            case ANTHROPIC -> anthropic;
            case OPENAI -> openai;
        };
    }
}
