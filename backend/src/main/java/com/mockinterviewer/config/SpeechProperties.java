package com.mockinterviewer.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Azure AI Speech settings, bound from {@code app.speech.*}. When either is blank, voice features are off and
 * the frontend falls back to text-only.
 *
 * @param key    Speech resource key; never sent to the browser
 * @param region Speech resource region, e.g. "eastus"
 */
@ConfigurationProperties(prefix = "app.speech")
public record SpeechProperties(String key, String region) {

    public boolean enabled() {
        return key != null && !key.isBlank() && region != null && !region.isBlank();
    }
}
