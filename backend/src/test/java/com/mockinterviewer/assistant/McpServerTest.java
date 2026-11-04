package com.mockinterviewer.assistant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mockinterviewer.ai.AiOutputs.PlannedQuestion;
import com.mockinterviewer.ai.InterviewAi;
import com.mockinterviewer.company.CompanyRepository;
import com.mockinterviewer.interview.InterviewRepository;
import com.mockinterviewer.interviewer.InterviewerRepository;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;

/** The MCP server over real HTTP (JSON-RPC on POST /mcp), with Claude mocked out. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.datasource.url=jdbc:h2:mem:mcptest;DB_CLOSE_DELAY=-1",
        "app.ai.max-questions=2"
})
class McpServerTest {

    @LocalServerPort int port;
    @Autowired InterviewRepository interviews;
    @Autowired InterviewerRepository interviewers;
    @Autowired CompanyRepository companies;
    @Autowired ObjectMapper json;
    @MockitoBean InterviewAi ai;

    private RestClient http;
    private int nextId = 1;

    @BeforeEach
    void setUp() {
        interviews.deleteAll();
        interviewers.deleteAll();
        companies.deleteAll();
        http = RestClient.builder().baseUrl("http://localhost:" + port).build();
    }

    @Test
    void listsToolsAndManagesCompaniesAndInterviewers() throws Exception {
        rpc("initialize", Map.of("protocolVersion", "2025-06-18", "capabilities", Map.of(),
                "clientInfo", Map.of("name", "test", "version", "1")));
        JsonNode tools = rpc("tools/list", Map.of()).get("tools");
        assertThat(tools).extracting(t -> t.get("name").asText()).containsExactlyInAnyOrder("list_companies",
                "add_company", "list_interviewers", "add_interviewer", "list_interviews", "list_resumes", "get_resume",
                "start_interview");

        JsonNode added = call("add_company", Map.of("name", "Acme", "industry", "Rockets"));
        assertThat(added.get("isError").asBoolean()).isFalse();
        assertThat(call("add_company", Map.of("name", "acme")).get("isError").asBoolean()).as("duplicate").isTrue();

        // Companies resolve by (partial) name.
        assertThat(call("add_interviewer", Map.of("company", "acm", "name", "Priya", "yearsOfExperience", 12))
                .get("isError").asBoolean()).isFalse();
        assertThat(text(call("list_interviewers", Map.of("company", "Acme")))).contains("Priya");
        assertThat(text(call("list_companies", Map.of()))).contains("\"interviewerCount\":1");
        JsonNode unknown = call("list_interviewers", Map.of("company", "Globex"));
        assertThat(unknown.get("isError").asBoolean()).isTrue();
        assertThat(text(unknown)).contains("No company matches", "Acme");
    }

    @Test
    void startInterviewNeedsAResumeThenReusesTheLastOne() throws Exception {
        when(ai.planInterview(any(), any())).thenReturn(List.of(new PlannedQuestion("Hello", "Tell me about you."),
                new PlannedQuestion("A", "Question A?"), new PlannedQuestion("B", "Question B?")));
        call("add_company", Map.of("name", "Acme"));
        call("add_interviewer", Map.of("company", "Acme", "name", "Priya"));

        assertThat(call("get_resume", Map.of()).get("isError").asBoolean()).as("no interviews yet").isTrue();
        assertThat(text(call("list_resumes", Map.of()))).isEqualTo("[]");

        JsonNode noResume = call("start_interview", Map.of("company", "Acme", "candidateName", "Alex"));
        assertThat(noResume.get("isError").asBoolean()).isTrue();
        assertThat(text(noResume)).contains("No resume available");

        String resume = "Alex - backend engineer, 5 years of Java and Spring, built payment APIs and led a migration.";
        JsonNode first = call("start_interview", Map.of("company", "Acme", "candidateName", "Alex",
                "resumeText", resume, "topics", List.of("Kafka")));
        assertThat(first.get("isError").asBoolean()).as(text(first)).isFalse();
        assertThat(json.readTree(text(first)).get("plannedQuestions").asInt()).isEqualTo(3);

        // No name or resume given: both come from the last interview.
        JsonNode second = call("start_interview", Map.of("company", "acme"));
        JsonNode result = json.readTree(text(second));
        assertThat(result.get("candidateName").asText()).isEqualTo("Alex");
        assertThat(result.get("resume").asText()).contains("reused resume.txt");
        assertThat(result.get("url").asText()).startsWith("/interviews/");

        // Both interviews used the same file: listed once, with both interviews; its text comes back as given.
        JsonNode resumes = json.readTree(text(call("list_resumes", Map.of())));
        assertThat(resumes).hasSize(1);
        assertThat(resumes.get(0).get("type").asText()).isEqualTo("text");
        assertThat(resumes.get(0).get("interviews")).hasSize(2);
        JsonNode latest = json.readTree(text(call("get_resume", Map.of())));
        assertThat(latest.get("text").asText()).isEqualTo(resume);
        assertThat(latest.get("interviewId").asLong()).isEqualTo(result.get("interviewId").asLong());
        JsonNode byId = json.readTree(text(call("get_resume",
                Map.of("interviewId", json.readTree(text(first)).get("interviewId").asLong()))));
        assertThat(byId.get("candidateName").asText()).isEqualTo("Alex");
        JsonNode missing = call("get_resume", Map.of("interviewId", 999_999));
        assertThat(missing.get("isError").asBoolean()).isTrue();
        assertThat(text(missing)).contains("No interview with id 999999");

        JsonNode panel = call("start_interview", Map.of("company", "Acme", "mode", "PANEL"));
        assertThat(panel.get("isError").asBoolean()).isTrue();
        assertThat(text(panel)).contains("panel needs at least 2");
    }

    @Test
    void rejectsForeignHosts() {
        HttpClientErrorException e = org.junit.jupiter.api.Assertions.assertThrows(HttpClientErrorException.class,
                () -> http.post().uri("/mcp").header("Host", "evil.example").header("Origin", "http://evil.example")
                        .contentType(MediaType.APPLICATION_JSON).accept(MediaType.APPLICATION_JSON)
                        .body(Map.of("jsonrpc", "2.0", "id", 1, "method", "tools/list")).retrieve().body(String.class));
        assertThat(e.getStatusCode().value()).isIn(403, 421);
    }

    private JsonNode call(String tool, Map<String, Object> args) throws Exception {
        return rpc("tools/call", Map.of("name", tool, "arguments", args));
    }

    private static String text(JsonNode callResult) {
        return callResult.get("content").get(0).get("text").asText();
    }

    private JsonNode rpc(String method, Map<String, Object> params) throws Exception {
        String body = http.post().uri("/mcp")
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON, MediaType.TEXT_EVENT_STREAM)
                .body(Map.of("jsonrpc", "2.0", "id", nextId++, "method", method, "params", params))
                .retrieve().body(String.class);
        JsonNode response = json.readTree(body);
        assertThat(response.has("error")).as(body).isFalse();
        return response.get("result");
    }
}
