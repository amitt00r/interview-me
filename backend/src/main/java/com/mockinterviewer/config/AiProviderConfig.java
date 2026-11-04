package com.mockinterviewer.config;

import com.mockinterviewer.ai.AiProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Exposes the {@link AiProvider} built by the selected provider's settings block, which validates itself and fails
 * startup when it is incomplete.
 */
@Configuration
public class AiProviderConfig {

    private static final Logger log = LoggerFactory.getLogger(AiProviderConfig.class);

    @Bean
    public AiProvider aiProvider(AiProperties props) {
        AiProviderSettings settings = props.selected();
        AiProvider provider = settings.createProvider();
        log.info("AI provider: {} (model {})", provider.displayName(), settings.model());
        return provider;
    }
}
