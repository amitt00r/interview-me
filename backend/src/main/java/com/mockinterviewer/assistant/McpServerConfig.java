package com.mockinterviewer.assistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.modelcontextprotocol.json.jackson2.JacksonMcpJsonMapper;
import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpStatelessServerFeatures.SyncToolSpecification;
import io.modelcontextprotocol.server.McpStatelessSyncServer;
import io.modelcontextprotocol.server.transport.DefaultServerTransportSecurityValidator;
import io.modelcontextprotocol.server.transport.HttpServletStatelessServerTransport;
import io.modelcontextprotocol.spec.McpSchema;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * MCP server at {@code /mcp} (Streamable HTTP, stateless), exposing {@link AssistantTools} to MCP clients such as
 * Claude Code: {@code claude mcp add --transport http interview-me http://localhost:8080/mcp}. There is no
 * authentication, so only localhost Host/Origin headers are accepted (DNS-rebinding protection); keep the backend
 * off untrusted networks.
 */
@Configuration
public class McpServerConfig {

    /** Starting an interview waits for Claude to plan every question. */
    private static final Duration REQUEST_TIMEOUT = Duration.ofMinutes(3);

    /** Loopback only, any port. */
    private static final List<String> LOCAL_HOSTS = List.of("localhost:*", "127.0.0.1:*", "[::1]:*", "localhost",
            "127.0.0.1");

    @Bean
    HttpServletStatelessServerTransport mcpTransport(ObjectMapper objectMapper) {
        return HttpServletStatelessServerTransport.builder()
                .jsonMapper(new JacksonMcpJsonMapper(objectMapper))
                .messageEndpoint("/mcp")
                .securityValidator(DefaultServerTransportSecurityValidator.builder()
                        .allowedHosts(LOCAL_HOSTS)
                        .allowedOrigins(List.of("http://localhost:*", "http://127.0.0.1:*"))
                        .build())
                .build();
    }

    @Bean
    ServletRegistrationBean<HttpServletStatelessServerTransport> mcpServlet(HttpServletStatelessServerTransport transport) {
        return new ServletRegistrationBean<>(transport, "/mcp");
    }

    @Bean(destroyMethod = "close")
    McpStatelessSyncServer mcpServer(HttpServletStatelessServerTransport transport, AssistantTools tools,
            ObjectMapper objectMapper) {
        List<SyncToolSpecification> specs = tools.definitions().stream()
                .map(def -> new SyncToolSpecification(
                        McpSchema.Tool.builder()
                                .name(def.name())
                                .description(def.description())
                                .inputSchema(def.inputSchema())
                                .build(),
                        (context, request) -> {
                            AssistantTools.ToolResult result = tools.call(def.name(), request.arguments(), null);
                            return McpSchema.CallToolResult.builder()
                                    .addTextContent(result.text())
                                    .isError(result.error())
                                    .build();
                        }))
                .toList();
        return McpServer.sync(transport)
                .serverInfo("interview-me", "1.0.0")
                .instructions("Mock interview practice app: manage companies and their interviewer panels, and "
                        + "start AI-run mock interviews. Interview URLs are relative to http://localhost:5173.")
                .capabilities(McpSchema.ServerCapabilities.builder().tools(false).build())
                .requestTimeout(REQUEST_TIMEOUT)
                .jsonMapper(new JacksonMcpJsonMapper(objectMapper))
                .tools(specs)
                .build();
    }
}
