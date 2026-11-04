package com.mockinterviewer.speech;

import com.mockinterviewer.config.SpeechProperties;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

/**
 * Exchanges the Azure Speech key for short-lived authorization tokens that the browser SDK can use, so the key
 * itself never leaves the server. Azure tokens live 10 minutes; one is cached and reused for 9, and callers are told how long it has left.
 */
@Service
public class SpeechTokenService {

    static final Duration REUSE_FOR = Duration.ofMinutes(9);

    private final SpeechProperties props;
    private final RestClient http;
    private final Clock clock;

    private String cachedToken;
    private Instant cachedUntil = Instant.MIN;
    private Instant issuedAt = Instant.MIN;

    @Autowired
    public SpeechTokenService(SpeechProperties props, RestClient.Builder http) {
        this(props, http, Clock.systemUTC());
    }

    SpeechTokenService(SpeechProperties props, RestClient.Builder http, Clock clock) {
        this.props = props;
        this.http = http.build();
        this.clock = clock;
    }

    public boolean enabled() {
        return props.enabled();
    }

    public String region() {
        return props.region();
    }

    /** Azure's token lifetime. */
    static final Duration LIFETIME = Duration.ofMinutes(10);

    /** A token and how long it stays valid, so the browser never keeps it past expiry. */
    public record IssuedToken(String token, long expiresInSeconds) {
    }

    /** Returns a token valid for at least one more minute. */
    public String token() {
        return issue().token();
    }

    /** Returns a token valid for at least one more minute, with its remaining lifetime. */
    public synchronized IssuedToken issue() {
        Instant now = clock.instant();
        if (cachedToken == null || now.isAfter(cachedUntil)) {
            cachedToken = http.post()
                    .uri("https://{region}.api.cognitive.microsoft.com/sts/v1.0/issueToken", props.region())
                    .header("Ocp-Apim-Subscription-Key", props.key())
                    .retrieve()
                    .body(String.class);
            issuedAt = now;
            cachedUntil = now.plus(REUSE_FOR);
        }
        return new IssuedToken(cachedToken, Duration.between(now, issuedAt.plus(LIFETIME)).toSeconds());
    }
}
