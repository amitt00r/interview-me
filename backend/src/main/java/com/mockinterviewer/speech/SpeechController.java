package com.mockinterviewer.speech;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClientException;

@RestController
@RequestMapping("/api/speech")
public class SpeechController {

    private static final Logger log = LoggerFactory.getLogger(SpeechController.class);

    private final SpeechTokenService tokens;

    public SpeechController(SpeechTokenService tokens) {
        this.tokens = tokens;
    }

    /**
     * @param enabled false when speech isn't configured or Azure rejected the key; the UI then runs text-only
     * @param reason  why speech is unavailable, for display
     * @param expiresInSeconds how long the token stays valid; the browser must not reuse it past that
     */
    public record SpeechToken(boolean enabled, String token, String region, String reason, Long expiresInSeconds) {
    }

    @GetMapping("/token")
    public SpeechToken token() {
        if (!tokens.enabled()) {
            return new SpeechToken(false, null, null,
                    "Voice is off: set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION for the backend.", null);
        }
        try {
            SpeechTokenService.IssuedToken issued = tokens.issue();
            return new SpeechToken(true, issued.token(), tokens.region(), null, issued.expiresInSeconds());
        } catch (RestClientException e) {
            log.warn("Azure Speech token request failed", e);
            return new SpeechToken(false, null, null,
                    "Voice is unavailable: Azure Speech rejected the token request. Check the key and region.", null);
        }
    }
}
