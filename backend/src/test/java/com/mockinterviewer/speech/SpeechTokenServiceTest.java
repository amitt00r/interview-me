package com.mockinterviewer.speech;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withUnauthorizedRequest;

import com.mockinterviewer.config.SpeechProperties;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class SpeechTokenServiceTest {

    private static final String ISSUE_URL = "https://eastus.api.cognitive.microsoft.com/sts/v1.0/issueToken";

    private final RestClient.Builder builder = RestClient.builder();
    private final MockRestServiceServer azure = MockRestServiceServer.bindTo(builder).build();

    @Test
    void reportsDisabledWhenNotConfigured() {
        SpeechController controller = new SpeechController(
                new SpeechTokenService(new SpeechProperties("", ""), builder));

        SpeechController.SpeechToken result = controller.token();

        assertThat(result.enabled()).isFalse();
        assertThat(result.token()).isNull();
        assertThat(result.reason()).contains("AZURE_SPEECH_KEY");
    }

    @Test
    void cachesTokenUntilReuseWindowExpires() {
        MutableClock clock = new MutableClock(Instant.parse("2026-01-01T00:00:00Z"));
        SpeechTokenService service = new SpeechTokenService(new SpeechProperties("secret", "eastus"), builder, clock);
        azure.expect(requestTo(ISSUE_URL)).andExpect(method(HttpMethod.POST))
                .andExpect(header("Ocp-Apim-Subscription-Key", "secret"))
                .andRespond(withSuccess("token-1", MediaType.TEXT_PLAIN));
        azure.expect(requestTo(ISSUE_URL)).andRespond(withSuccess("token-2", MediaType.TEXT_PLAIN));

        assertThat(service.token()).isEqualTo("token-1");
        clock.advance(Duration.ofMinutes(8));
        assertThat(service.token()).isEqualTo("token-1");
        clock.advance(Duration.ofMinutes(2));
        assertThat(service.token()).isEqualTo("token-2");
        azure.verify();
    }

    @Test
    void reportsHowLongTheReusedTokenStaysValid() {
        MutableClock clock = new MutableClock(Instant.parse("2026-01-01T00:00:00Z"));
        SpeechTokenService service = new SpeechTokenService(new SpeechProperties("secret", "eastus"), builder, clock);
        azure.expect(requestTo(ISSUE_URL)).andRespond(withSuccess("token-1", MediaType.TEXT_PLAIN));
        azure.expect(requestTo(ISSUE_URL)).andRespond(withSuccess("token-2", MediaType.TEXT_PLAIN));

        assertThat(service.issue()).isEqualTo(new SpeechTokenService.IssuedToken("token-1", 600));
        // Reused 8 minutes later: only 2 minutes left, which the browser must not exceed.
        clock.advance(Duration.ofMinutes(8));
        assertThat(service.issue()).isEqualTo(new SpeechTokenService.IssuedToken("token-1", 120));
        clock.advance(Duration.ofMinutes(2));
        assertThat(service.issue()).isEqualTo(new SpeechTokenService.IssuedToken("token-2", 600));
        azure.verify();
    }

    @Test
    void azureRejectionDisablesVoiceInsteadOfFailing() {
        SpeechController controller = new SpeechController(
                new SpeechTokenService(new SpeechProperties("bad", "eastus"), builder));
        azure.expect(requestTo(ISSUE_URL)).andRespond(withUnauthorizedRequest());

        SpeechController.SpeechToken result = controller.token();

        assertThat(result.enabled()).isFalse();
        assertThat(result.reason()).contains("rejected");
    }

    private static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant start) {
            this.now = start;
        }

        void advance(Duration d) {
            now = now.plus(d);
        }

        @Override public Instant instant() { return now; }
        @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
    }
}
