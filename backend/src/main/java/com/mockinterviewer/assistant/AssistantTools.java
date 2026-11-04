package com.mockinterviewer.assistant;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mockinterviewer.common.AiResponseException;
import com.mockinterviewer.common.BadRequestException;
import com.mockinterviewer.common.NotFoundException;
import com.mockinterviewer.common.ValidationException;
import com.mockinterviewer.company.CompanyService;
import com.mockinterviewer.company.CompanyDtos.CompanyRequest;
import com.mockinterviewer.company.CompanyDtos.CompanyResponse;
import com.mockinterviewer.interview.Interview;
import com.mockinterviewer.interview.InterviewMode;
import com.mockinterviewer.interview.InterviewService;
import com.mockinterviewer.interview.InterviewService.ResumeUpload;
import com.mockinterviewer.interview.InterviewService.RoundRequest;
import com.mockinterviewer.interview.InterviewStatus;
import com.mockinterviewer.interviewer.InterviewerService;
import com.mockinterviewer.interviewer.InterviewerDtos.InterviewerRequest;
import com.mockinterviewer.interviewer.InterviewerDtos.InterviewerResponse;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * The app's actions as tools: list and add companies and interviewers, list interviews and the resumes they used,
 * read a resume, start an interview. Defined
 * once and served twice: to MCP clients through {@link McpServerConfig} (/mcp) and to Claude in Nikolai's chat
 * ({@link NikolaiService}). Handlers go through the same services as the REST API, so validation
 * and duplicate checks are identical. Results are JSON text; failures come back as error results, not exceptions,
 * so the model can explain them and retry.
 */
@Service
public class AssistantTools {

    private static final Logger log = LoggerFactory.getLogger(AssistantTools.class);

    private static final int MAX_RESUME_TEXT_CHARS = 100_000;

    /** A tool's name, description and JSON input schema. */
    public record ToolDef(String name, String description, Map<String, Object> inputSchema) {
    }

    /**
     * What a tool returned: JSON (or an error message) for the model, plus where the app should go next when the
     * action has a page (e.g. the new interview's room), for clients that can navigate.
     */
    public record ToolResult(String text, boolean error, String navigateTo, String linkLabel) {

        static ToolResult ok(String json) {
            return new ToolResult(json, false, null, null);
        }

        static ToolResult ok(String json, String navigateTo, String linkLabel) {
            return new ToolResult(json, false, navigateTo, linkLabel);
        }

        static ToolResult error(String message) {
            return new ToolResult(message, true, null, null);
        }
    }

    private final CompanyService companies;
    private final InterviewerService interviewers;
    private final InterviewService interviews;
    private final Validator validator;
    private final ObjectMapper json;

    public AssistantTools(CompanyService companies, InterviewerService interviewers,
            InterviewService interviews, Validator validator, ObjectMapper json) {
        this.companies = companies;
        this.interviewers = interviewers;
        this.interviews = interviews;
        this.validator = validator;
        this.json = json;
    }

    public List<ToolDef> definitions() {
        return List.of(
                new ToolDef("list_companies",
                        "List the companies set up for mock interviews, with how many interviewers each has.",
                        object(Map.of(), List.of())),
                new ToolDef("add_company",
                        "Add a company to interview for. Its description and interview focus steer the questions "
                                + "its interviewers ask. Names must be unique.",
                        object(props(
                                "name", str("Company name, e.g. 'Stripe'."),
                                "industry", str("Industry, e.g. 'Fintech'."),
                                "description", str("What the company builds, size, engineering culture."),
                                "interviewFocus", str("What its interviews look for: values, bar, typical rounds."),
                                "logoUrl", str("Optional URL of a logo image.")), List.of("name"))),
                new ToolDef("list_interviewers",
                        "List a company's interviewers (its interview panel).",
                        object(props("company", str("Company id or name.")), List.of("company"))),
                new ToolDef("add_interviewer",
                        "Add an interviewer persona to a company's panel. One-on-one interviews need one "
                                + "interviewer; panel interviews need at least two.",
                        object(props(
                                "company", str("Company id or name."),
                                "name", str("Interviewer's full name."),
                                "title", str("Job title, e.g. 'Staff Backend Engineer'."),
                                "yearsOfExperience", integer("Years of experience, 0-60.", 0, 60),
                                "expertise", str("Areas they question on, e.g. 'Distributed systems, Java'."),
                                "background", str("Background and interviewing style."),
                                "voice", str("Optional Azure neural voice id, e.g. 'en-US-AndrewNeural'; "
                                        + "omit for a default.")), List.of("company", "name"))),
                new ToolDef("list_interviews",
                        "List interviews, most recent first, with status and overall score (0-100).",
                        object(props(
                                "status", enumeration("Which interviews: in_progress, finished (completed or "
                                        + "abandoned) or all. Defaults to all.", "in_progress", "finished", "all"),
                                "limit", integer("At most this many, 1-50. Defaults to 10.", 1, 50)), List.of())),
                new ToolDef("list_resumes",
                        "List the resumes used in past interviews, most recently used first: file name, type, "
                                + "candidate, target role and which interviews used it. Identical files are listed "
                                + "once. Read one with get_resume.",
                        object(props("limit", integer("At most this many, 1-50. Defaults to 10.", 1, 50)),
                                List.of())),
                new ToolDef("get_resume",
                        "Get the text of the resume an interview used: the most recent interview's by default, "
                                + "or the given interview's (ids from list_resumes or list_interviews). PDFs are "
                                + "returned as their extracted text.",
                        object(props("interviewId", integer("Interview id; omit for the most recent interview.", 1,
                                Integer.MAX_VALUE)), List.of())),
                new ToolDef("start_interview",
                        "Start a mock interview at a company. Claude plans every question up front, which takes "
                                + "up to a minute; the result has the interview's URL. The candidate name and resume "
                                + "default to those of the most recent interview; a resume attached in chat or "
                                + "given as resumeText takes precedence.",
                        object(props(
                                "company", str("Company id or name. It needs at least one interviewer (two for "
                                        + "a panel)."),
                                "mode", enumeration("ONE_ON_ONE (default) or PANEL.", "ONE_ON_ONE", "PANEL"),
                                "candidateName", str("Candidate's name; defaults to the last interview's."),
                                "targetRole", str("Role being interviewed for, e.g. 'Senior Backend Engineer'."),
                                "jobDescription", str("Full job posting text (at least 50 characters) to tailor "
                                        + "the questions to."),
                                "roundName", str("Name of the round, e.g. 'System design'."),
                                "roundDescription", str("What the round covers and how it is run."),
                                "topics", Map.of("type", "array", "items", Map.of("type", "string"),
                                        "description", "Focus topics in priority order, e.g. ['Kafka', 'Java Core']; "
                                                + "every main question is then about one of them."),
                                "resumeText", str("The candidate's resume as plain text, when not reusing the "
                                        + "last one."),
                                "answerPauseSeconds", integer("Hands-free answering: seconds of silence before an "
                                        + "answer is submitted (3-60, default 10). Shorter trains speaking "
                                        + "continuously.", 3, 60)), List.of("company"))));
    }

    /** Runs a tool. {@code attachedResume} is a resume uploaded in Nikolai's chat, if any (MCP clients: null). */
    public ToolResult call(String name, Map<String, Object> args, ResumeUpload attachedResume) {
        Map<String, Object> a = args == null ? Map.of() : args;
        try {
            ToolResult result = switch (name) {
                case "list_companies" -> ToolResult.ok(write(companies.list().stream().map(this::companySummary).toList()));
                case "add_company" -> addCompany(a);
                case "list_interviewers" -> listInterviewers(a);
                case "add_interviewer" -> addInterviewer(a);
                case "list_interviews" -> listInterviews(a);
                case "list_resumes" -> listResumes(a);
                case "get_resume" -> getResume(a);
                case "start_interview" -> startInterview(a, attachedResume);
                default -> ToolResult.error("Unknown tool: " + name);
            };
            log.info("Assistant tool {} -> {}", name, result.error() ? "error: " + result.text() : "ok");
            return result;
        } catch (ValidationException e) {
            return ToolResult.error("Please fix: " + e.getErrors().entrySet().stream()
                    .map(en -> en.getKey() + ": " + en.getValue()).collect(Collectors.joining("; ")));
        } catch (BadRequestException | NotFoundException | AiResponseException | IllegalArgumentException e) {
            return ToolResult.error(e.getMessage());
        }
    }

    private ToolResult addCompany(Map<String, Object> a) {
        CompanyRequest req = new CompanyRequest(string(a, "name"), string(a, "industry"), string(a, "description"),
                string(a, "interviewFocus"), string(a, "logoUrl"));
        validate(req);
        CompanyResponse c = companies.create(req);
        return ToolResult.ok(write(companySummary(c)), "/companies/" + c.id(), "Open " + c.name());
    }

    private ToolResult listInterviewers(Map<String, Object> a) {
        CompanyResponse c = resolveCompany(string(a, "company"));
        List<Map<String, Object>> panel = interviewers.list(c.id()).stream().map(this::interviewerSummary).toList();
        return ToolResult.ok(write(Map.of("company", c.name(), "interviewers", panel)));
    }

    private ToolResult addInterviewer(Map<String, Object> a) {
        CompanyResponse c = resolveCompany(string(a, "company"));
        Integer years = integerArg(a, "yearsOfExperience");
        InterviewerRequest req = new InterviewerRequest(string(a, "name"), string(a, "title"),
                years == null ? 5 : years, string(a, "expertise"), string(a, "background"), string(a, "voice"), c.id());
        validate(req);
        InterviewerResponse i = interviewers.create(req);
        return ToolResult.ok(write(interviewerSummary(i)), "/companies/" + c.id(), "Open " + c.name());
    }

    private ToolResult listInterviews(Map<String, Object> a) {
        String status = string(a, "status");
        List<InterviewStatus> statuses = switch (status == null ? "all" : status.toLowerCase(Locale.ROOT)) {
            case "in_progress" -> List.of(InterviewStatus.IN_PROGRESS);
            case "finished" -> List.of(InterviewStatus.COMPLETED, InterviewStatus.ABANDONED);
            default -> List.of(InterviewStatus.values());
        };
        Integer limit = integerArg(a, "limit");
        int max = limit == null ? 10 : Math.max(1, Math.min(50, limit));
        List<Map<String, Object>> rows = interviews.list(statuses).stream().limit(max).map(i -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", i.getId());
            row.put("company", i.getCompany().getName());
            row.put("status", i.getStatus().name());
            row.put("overallScore", i.getOverallScore());
            row.put("mode", i.getMode().name());
            row.put("roundName", i.getRoundName());
            row.put("attempt", i.getAttempt());
            row.put("startedAt", String.valueOf(i.getStartedAt()));
            row.put("url", "/interviews/" + i.getId());
            return row;
        }).toList();
        return ToolResult.ok(write(rows));
    }

    private ToolResult listResumes(Map<String, Object> a) {
        Integer limit = integerArg(a, "limit");
        int max = limit == null ? 10 : Math.max(1, Math.min(50, limit));
        // Grouped by file content, in order of most recent use (the list is newest interview first).
        Map<String, Map<String, Object>> byFile = new LinkedHashMap<>();
        for (var used : interviews.usedResumes()) {
            Map<String, Object> row = byFile.computeIfAbsent(ResumeText.fingerprint(used.resume()), k -> {
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("latestInterviewId", used.interviewId());
                r.put("fileName", used.resume().fileName());
                r.put("type", ResumeText.isPdf(used.resume()) ? "pdf" : "text");
                r.put("sizeBytes", used.resume().data() == null ? 0 : used.resume().data().length);
                r.put("candidateName", used.candidateName());
                r.put("targetRole", used.targetRole());
                r.put("lastUsed", String.valueOf(used.startedAt()));
                r.put("interviews", new ArrayList<Map<String, Object>>());
                return r;
            });
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> uses = (List<Map<String, Object>>) row.get("interviews");
            uses.add(Map.of("id", used.interviewId(), "company", used.company()));
        }
        return ToolResult.ok(write(byFile.values().stream().limit(max).toList()));
    }

    private ToolResult getResume(Map<String, Object> a) {
        Integer id = integerArg(a, "interviewId");
        var used = interviews.resumeOf(id == null ? null : id.longValue());
        if (used.isEmpty()) {
            return ToolResult.error(id == null ? "There are no interviews yet, so no resume to read."
                    : "No interview with id " + id + ".");
        }
        var u = used.get();
        String text = ResumeText.extract(u.resume());
        boolean truncated = text.length() > MAX_RESUME_TEXT_CHARS;
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("interviewId", u.interviewId());
        out.put("company", u.company());
        out.put("candidateName", u.candidateName());
        out.put("targetRole", u.targetRole());
        out.put("fileName", u.resume().fileName());
        out.put("type", ResumeText.isPdf(u.resume()) ? "pdf" : "text");
        out.put("truncated", truncated);
        out.put("text", truncated ? text.substring(0, MAX_RESUME_TEXT_CHARS) : text);
        return ToolResult.ok(write(out));
    }

    private ToolResult startInterview(Map<String, Object> a, ResumeUpload attachedResume) {
        CompanyResponse c = resolveCompany(string(a, "company"));
        var latest = interviews.latestProfile();
        String resumeText = string(a, "resumeText");
        ResumeUpload resume;
        String resumeSource;
        if (resumeText != null && !resumeText.isBlank()) {
            if (resumeText.length() > MAX_RESUME_TEXT_CHARS) {
                return ToolResult.error("resumeText is too long (max " + MAX_RESUME_TEXT_CHARS + " characters).");
            }
            resume = new ResumeUpload("resume.txt", "text/plain", resumeText.getBytes(StandardCharsets.UTF_8));
            resumeSource = "resume text given";
        } else if (attachedResume != null) {
            resume = attachedResume;
            resumeSource = "attached " + attachedResume.fileName();
        } else if (latest.isPresent()) {
            resume = latest.get().resume();
            resumeSource = "reused " + resume.fileName() + " from the last interview";
        } else {
            return ToolResult.error("No resume available: there are no earlier interviews to reuse one from. Ask "
                    + "the candidate to attach a resume (PDF or .txt) or provide it as text.");
        }
        String candidate = string(a, "candidateName");
        if ((candidate == null || candidate.isBlank()) && latest.isPresent()) {
            candidate = latest.get().candidateName();
        }
        String mode = string(a, "mode");
        InterviewMode interviewMode;
        try {
            interviewMode = mode == null ? InterviewMode.ONE_ON_ONE : InterviewMode.valueOf(mode.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return ToolResult.error("mode must be ONE_ON_ONE or PANEL.");
        }
        Interview started = interviews.start(candidate, string(a, "targetRole"), string(a, "jobDescription"), c.id(),
                interviewMode, new RoundRequest(string(a, "roundName"), string(a, "roundDescription"),
                        stringList(a, "topics")),
                resume, integerArg(a, "answerPauseSeconds"));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("interviewId", started.getId());
        out.put("url", "/interviews/" + started.getId());
        out.put("company", c.name());
        out.put("mode", interviewMode.name());
        out.put("candidateName", started.getCandidateName());
        out.put("interviewers", started.getInterviewers().stream().map(i -> i.getName()).toList());
        out.put("plannedQuestions", started.getPlannedQuestions());
        out.put("answerPauseSeconds", started.getAnswerPauseSeconds());
        out.put("resume", resumeSource);
        return ToolResult.ok(write(out), "/interviews/" + started.getId(), "Join the interview");
    }

    /** A company by id or by name: exact (case-insensitive) first, then a unique partial match. */
    private CompanyResponse resolveCompany(String ref) {
        if (ref == null || ref.isBlank()) {
            throw new IllegalArgumentException("Say which company (id or name).");
        }
        String r = ref.strip();
        if (r.matches("\\d+")) {
            return companies.get(Long.parseLong(r));
        }
        List<CompanyResponse> all = companies.list();
        String lower = r.toLowerCase(Locale.ROOT);
        var exact = all.stream().filter(c -> c.name().equalsIgnoreCase(r)).findFirst();
        if (exact.isPresent()) {
            return exact.get();
        }
        List<CompanyResponse> partial = all.stream()
                .filter(c -> c.name().toLowerCase(Locale.ROOT).contains(lower)).toList();
        if (partial.size() == 1) {
            return partial.get(0);
        }
        throw new IllegalArgumentException((partial.isEmpty() ? "No company matches '" : "Several companies match '")
                + r + "'. Companies: " + all.stream().map(CompanyResponse::name).collect(Collectors.joining(", ")));
    }

    private Map<String, Object> companySummary(CompanyResponse c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", c.id());
        m.put("name", c.name());
        m.put("industry", c.industry());
        m.put("interviewerCount", c.interviewerCount());
        m.put("url", "/companies/" + c.id());
        return m;
    }

    private Map<String, Object> interviewerSummary(InterviewerResponse i) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", i.id());
        m.put("name", i.name());
        m.put("title", i.title());
        m.put("yearsOfExperience", i.yearsOfExperience());
        m.put("expertise", i.expertise());
        m.put("company", i.companyName());
        return m;
    }

    /** Bean Validation on a request record, as @Valid does for the REST API. */
    private void validate(Object request) {
        Set<ConstraintViolation<Object>> violations = validator.validate(request);
        if (!violations.isEmpty()) {
            Map<String, String> errors = new LinkedHashMap<>();
            violations.forEach(v -> errors.put(v.getPropertyPath().toString(), v.getMessage()));
            throw new ValidationException(errors);
        }
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String string(Map<String, Object> a, String key) {
        Object v = a.get(key);
        return v == null ? null : v.toString();
    }

    private static Integer integerArg(Map<String, Object> a, String key) {
        Object v = a.get(key);
        if (v == null) {
            return null;
        }
        if (v instanceof Number n) {
            return n.intValue();
        }
        try {
            return Integer.parseInt(v.toString().trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(key + " must be a whole number.");
        }
    }

    private static List<String> stringList(Map<String, Object> a, String key) {
        Object v = a.get(key);
        if (v instanceof List<?> list) {
            List<String> out = new ArrayList<>();
            list.forEach(item -> out.add(String.valueOf(item)));
            return out;
        }
        return v == null ? List.of() : List.of(v.toString());
    }

    // --- JSON schema helpers ---

    private static Map<String, Object> object(Map<String, Object> properties, List<String> required) {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");
        schema.put("properties", properties);
        schema.put("required", required);
        schema.put("additionalProperties", false);
        return schema;
    }

    /** Ordered properties from name/schema pairs. */
    private static Map<String, Object> props(Object... pairs) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            m.put((String) pairs[i], pairs[i + 1]);
        }
        return m;
    }

    private static Map<String, Object> str(String description) {
        return Map.of("type", "string", "description", description);
    }

    private static Map<String, Object> integer(String description, int min, int max) {
        return Map.of("type", "integer", "description", description, "minimum", min, "maximum", max);
    }

    private static Map<String, Object> enumeration(String description, String... values) {
        return Map.of("type", "string", "description", description, "enum", List.of(values));
    }
}
