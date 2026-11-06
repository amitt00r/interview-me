package com.mockinterviewer.interview;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.mockinterviewer.ai.AiOutputs.FinalEvaluation;
import com.mockinterviewer.ai.AiOutputs.CodeEditor;
import com.mockinterviewer.ai.AiOutputs.NextAction;
import com.mockinterviewer.ai.AiOutputs.PanelAssignment;
import com.mockinterviewer.ai.AiOutputs.PlannedQuestion;
import com.mockinterviewer.ai.AiOutputs.StudyGuide;
import com.mockinterviewer.ai.AiOutputs.StudyTopic;
import com.mockinterviewer.ai.AiOutputs.TurnDecision;
import com.mockinterviewer.ai.InterviewAi;
import com.mockinterviewer.common.BadRequestException;
import com.mockinterviewer.company.Company;
import com.mockinterviewer.company.CompanyRepository;
import com.mockinterviewer.ai.InterviewAi.PlanSlot;
import com.mockinterviewer.interview.InterviewService.FormatRequest;
import com.mockinterviewer.interview.InterviewService.ResumeUpload;
import com.mockinterviewer.interview.InterviewService.RoundRequest;
import org.mockito.ArgumentCaptor;
import com.mockinterviewer.interviewer.Interviewer;
import com.mockinterviewer.interviewer.InterviewerRepository;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** End-to-end interview state machine against an in-memory DB, with Claude mocked out. */
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:flowtest;DB_CLOSE_DELAY=-1",
        "app.ai.max-questions=2",
        "app.ai.max-follow-ups=1"
})
@AutoConfigureMockMvc
class InterviewFlowTest {

    private static final List<String> PLAN = List.of("Tell me about yourself.", "Design a cache?", "Lead a migration?");

    @Autowired InterviewService service;
    @Autowired InterviewRepository interviews;
    @Autowired CompanyRepository companies;
    @Autowired InterviewerRepository interviewers;
    @Autowired MockMvc mvc;
    @MockitoBean InterviewAi ai;

    private Company company;

    @BeforeEach
    void setUp() {
        interviews.deleteAll();
        interviewers.deleteAll();
        companies.deleteAll();
        company = companies.save(new Company("Acme " + System.nanoTime(), "Tech", "", "System design", null));
        interviewers.save(new Interviewer("Priya", "Staff Engineer", 12, "Java", "", null, company));
        interviewers.save(new Interviewer("Sam", "EM", 9, "Leadership", "", null, company));
        // max-questions=2, so the plan is the introduction plus 2 main questions.
        when(ai.planInterview(any(), any())).thenReturn(List.of(
                new PlannedQuestion("Hello", PLAN.get(0)),
                new PlannedQuestion("Caching", PLAN.get(1)),
                new PlannedQuestion("Leadership", PLAN.get(2))));
        when(ai.finalEvaluation(any())).thenReturn(
                new FinalEvaluation(140, "Solid.", List.of("Clear"), List.of("Depth")));
    }

    @Test
    void startPlansEveryQuestionUpFrontAndAsksTheFirst() throws Exception {
        Interview started = start(InterviewMode.PANEL);

        assertThat(started.getPlan()).extracting(InterviewQuestion::getText).containsExactlyElementsOf(PLAN);
        assertThat(started.getPlan().getFirst().getTopic()).isEqualTo("Introduction");
        Long first = started.getPlan().get(0).getAskedBy().getId();
        assertThat(started.getPlan().get(1).getAskedBy().getId()).as("rotates through the panel").isNotEqualTo(first);
        assertThat(started.getPlan().get(2).getAskedBy().getId()).isEqualTo(first);
        assertThat(started.getPlannedQuestions()).isEqualTo(3);
        assertThat(started.getTurns()).singleElement().extracting(InterviewTurn::getQuestion).isEqualTo(PLAN.get(0));

        mvc.perform(get("/api/interviews/" + started.getId()))
                .andExpect(jsonPath("$.questions.length()").value(3))
                .andExpect(jsonPath("$.questions[0].status").value("CURRENT"))
                .andExpect(jsonPath("$.questions[1].status").value("NOT_ATTEMPTED"));
    }

    @Test
    void startReportsEveryInvalidFieldAtOnceWithoutPlanning() throws Exception {
        mvc.perform(multipart("/api/interviews")
                        .file(new MockMultipartFile("resume", "cv.pdf", "application/pdf", "not a pdf".getBytes()))
                        .param("candidateName", "  ")
                        .param("jobDescription", "Too short.")
                        .param("mode", "PANEL"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.candidateName").exists())
                .andExpect(jsonPath("$.errors.jobDescription").exists())
                .andExpect(jsonPath("$.errors.companyId").exists())
                .andExpect(jsonPath("$.errors.resume").exists());

        Company solo = companies.save(new Company("Solo " + System.nanoTime(), "", "", "", null));
        interviewers.save(new Interviewer("Lee", "Engineer", 5, "", "", null, solo));
        mvc.perform(multipart("/api/interviews")
                        .file(new MockMultipartFile("resume", "cv.txt", "text/plain", resumeBytes()))
                        .param("candidateName", "Alex")
                        .param("companyId", String.valueOf(solo.getId()))
                        .param("mode", "PANEL"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.companyId").value(containsString("panel")));

        verify(ai, never()).planInterview(any(), any());
    }

    @Test
    void followUpsHangOffTheirQuestionAndMainQuestionsComeFromThePlan() throws Exception {
        Long id = start(InterviewMode.PANEL).getId();

        // A follow-up on the introduction, asked by whoever asked it.
        decide(NextAction.FOLLOW_UP, 6, "Why Java?");
        Interview i = service.answer(id, "I build APIs.", 30);
        InterviewTurn followUp = i.getTurns().getLast();
        assertThat(followUp.isFollowUp()).isTrue();
        assertThat(followUp.getPlannedQuestion().getPosition()).isEqualTo(1);
        assertThat(followUp.getAskedBy().getId()).isEqualTo(i.getPlan().getFirst().getAskedBy().getId());
        assertThat(i.getTurns().getFirst().getResponseSeconds()).isEqualTo(30);

        // A second follow-up exceeds max-follow-ups, so the next planned question is asked as written.
        decide(NextAction.FOLLOW_UP, 7, "And why not Go?");
        i = service.answer(id, "Mature ecosystem.", 30);
        assertThat(i.getTurns().getLast().getQuestion()).isEqualTo(PLAN.get(1));
        assertThat(i.getTurns().getLast().getPlannedQuestion().getPosition()).isEqualTo(2);

        decide(NextAction.NEXT_QUESTION, 8, "");
        i = service.answer(id, "LRU with a TTL.", 30);
        assertThat(i.getTurns().getLast().getQuestion()).isEqualTo(PLAN.get(2));

        // Plan exhausted: NEXT_QUESTION is coerced to END and the interview is scored.
        decide(NextAction.NEXT_QUESTION, 9, "");
        i = service.answer(id, "I led one.", 30);
        assertThat(i.getStatus()).isEqualTo(InterviewStatus.COMPLETED);
        assertThat(i.getOverallScore()).isEqualTo(100);
        assertThat(i.attemptedQuestions()).as("the follow-up doesn't count as a question").isEqualTo(3);

        // Through HTTP: per-question results, and the panel must not double counts in list summaries.
        mvc.perform(get("/api/interviews/" + id))
                .andExpect(jsonPath("$.questions[0].status").value("ANSWERED"))
                .andExpect(jsonPath("$.questions[0].score").value(6))
                .andExpect(jsonPath("$.questions[0].followUps.length()").value(1))
                .andExpect(jsonPath("$.questions[2].status").value("ANSWERED"));
        mvc.perform(get("/api/interviews?status=COMPLETED"))
                .andExpect(jsonPath("$[?(@.id == " + id + ")].attemptedQuestions").value(3))
                .andExpect(jsonPath("$[?(@.id == " + id + ")].plannedQuestions").value(3));
    }

    @Test
    void skippingMovesToTheNextPlannedQuestionWithoutAnyAiCall() {
        Long id = start(InterviewMode.ONE_ON_ONE).getId();

        Interview i = service.skip(id, 5);
        InterviewTurn skipped = i.getTurns().getFirst();
        assertThat(skipped.isSkipped()).isTrue();
        assertThat(skipped.getScore()).isZero();
        assertThat(skipped.getResponseSeconds()).isEqualTo(5);
        assertThat(i.getTurns().getLast().getQuestion()).isEqualTo(PLAN.get(1));

        service.skip(id, 5);
        Interview ended = service.skip(id, 5);
        // Everything skipped: nothing to evaluate, so it is abandoned rather than scored.
        assertThat(ended.getStatus()).isEqualTo(InterviewStatus.ABANDONED);
        assertThat(ended.skippedQuestions()).isEqualTo(3);
        verify(ai, never()).nextTurn(any(), any(), anyBoolean(), anyBoolean());
        verify(ai, never()).finalEvaluation(any());
    }

    @Test
    void endingEarlyLeavesTheRestNotAttemptedAndReattemptsReplayThePlan() throws Exception {
        Long originalId = start(InterviewMode.PANEL).getId();
        decide(NextAction.NEXT_QUESTION, 4, "");
        service.answer(originalId, "Hi, I'm Alex.", 30);
        Interview original = service.end(originalId);
        assertThat(original.getStatus()).isEqualTo(InterviewStatus.COMPLETED);
        mvc.perform(get("/api/interviews/" + originalId))
                .andExpect(jsonPath("$.questions[0].status").value("ANSWERED"))
                .andExpect(jsonPath("$.questions[1].status").value("NOT_ATTEMPTED"))
                .andExpect(jsonPath("$.questions[2].status").value("NOT_ATTEMPTED"));

        Interview retake = service.reattempt(originalId);
        assertThat(retake.getAttempt()).isEqualTo(2);
        assertThat(retake.getRetakeOf().getId()).isEqualTo(originalId);
        assertThat(retake.getPlan()).extracting(InterviewQuestion::getText).containsExactlyElementsOf(PLAN);
        assertThat(retake.getPlan()).extracting(q -> q.getAskedBy().getId())
                .containsExactlyElementsOf(original.getPlan().stream().map(q -> q.getAskedBy().getId()).toList());
        assertThat(retake.getTurns()).singleElement().extracting(InterviewTurn::getQuestion).isEqualTo(PLAN.get(0));

        // Reattempting a reattempt copies the same plan again, as attempt 3.
        Interview third = service.reattempt(retake.getId());
        assertThat(third.getAttempt()).isEqualTo(3);
        assertThat(third.getPlan()).extracting(InterviewQuestion::getText).containsExactlyElementsOf(PLAN);
        assertThat(service.attempts(third.getId())).extracting(Interview::getAttempt).containsExactly(1, 2, 3);

        // Deleting goes by interview, not attempt: deleting via a reattempt removes everything.
        service.delete(retake.getId());
        assertThat(interviews.findAll()).isEmpty();
    }

    @Test
    void studyGuidesAreGeneratedOnceAfterTheInterviewAndStoredPerQuestion() throws Exception {
        Long id = start(InterviewMode.ONE_ON_ONE).getId();
        Long firstId = service.get(id).getPlan().get(0).getId();
        Long secondId = service.get(id).getPlan().get(1).getId();
        mvc.perform(post("/api/interviews/" + id + "/questions/" + firstId + "/study-guide"))
                .andExpect(status().isBadRequest());

        decide(NextAction.FOLLOW_UP, 4, "Why backend?");
        service.answer(id, "Hi, I'm Alex.", 30);
        decide(NextAction.NEXT_QUESTION, 5, "");
        service.answer(id, "I like APIs.", 20);
        Interview ended = service.end(id);
        Long followUpId = ended.getTurns().stream().filter(InterviewTurn::isFollowUp).findFirst().orElseThrow().getId();
        Long secondMainId = ended.getTurns().stream().filter(t -> !t.isFollowUp()).toList().get(1).getId();
        when(ai.studyGuide(any(), any(), any())).thenReturn(new StudyGuide("I'm Alex, a backend engineer.",
                List.of(new StudyTopic("Elevator\tpitch", "Too short."), new StudyTopic(" ", "dropped"))));
        when(ai.followUpStudyGuide(any(), any(), eq(1), eq("answered"))).thenReturn(
                new StudyGuide("Because I enjoy designing APIs.", List.of(new StudyTopic("API design", "Be specific."))));

        mvc.perform(post("/api/interviews/" + id + "/questions/" + firstId + "/study-guide"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.modelAnswer").value("I'm Alex, a backend engineer."))
                .andExpect(jsonPath("$.studyTopics.length()").value(1))
                .andExpect(jsonPath("$.studyTopics[0].topic").value("Elevator pitch"))
                .andExpect(jsonPath("$.studyTopics[0].reason").value("Too short."));
        verify(ai).studyGuide(any(), any(), eq("answered"));
        mvc.perform(post("/api/interviews/" + id + "/turns/" + followUpId + "/study-guide"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.modelAnswer").value("Because I enjoy designing APIs."));

        // Stored: asking again doesn't call Claude, and the report includes both.
        mvc.perform(post("/api/interviews/" + id + "/questions/" + firstId + "/study-guide")).andExpect(status().isOk());
        mvc.perform(post("/api/interviews/" + id + "/turns/" + followUpId + "/study-guide")).andExpect(status().isOk());
        verify(ai, times(1)).studyGuide(any(), any(), any());
        verify(ai, times(1)).followUpStudyGuide(any(), any(), anyInt(), any());
        mvc.perform(get("/api/interviews/" + id))
                .andExpect(jsonPath("$.questions[0].studyGuide.modelAnswer").value("I'm Alex, a backend engineer."))
                .andExpect(jsonPath("$.questions[0].followUps[0].studyGuide.studyTopics[0].topic").value("API design"))
                .andExpect(jsonPath("$.questions[1].studyGuide").doesNotExist());

        // The second main question was dropped when the interview ended: coached as not reached.
        mvc.perform(post("/api/interviews/" + id + "/questions/" + secondId + "/study-guide")).andExpect(status().isOk());
        verify(ai).studyGuide(any(), any(), eq("not reached"));
        // Main turns go through the question endpoint, not the follow-up one.
        mvc.perform(post("/api/interviews/" + id + "/turns/" + secondMainId + "/study-guide"))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/interviews/" + id + "/questions/999999/study-guide")).andExpect(status().isNotFound());
    }

    @Test
    void answerPauseIsSavedCopiedToReattemptsAndValidated() throws Exception {
        ResumeUpload cv = new ResumeUpload("cv.txt", "text/plain", resumeBytes());
        Interview started = service.start("Alex", null, null, company.getId(), InterviewMode.ONE_ON_ONE,
                RoundRequest.NONE, cv, 5);
        mvc.perform(get("/api/interviews/" + started.getId())).andExpect(jsonPath("$.answerPauseSeconds").value(5));
        service.end(started.getId());
        assertThat(service.reattempt(started.getId()).getAnswerPauseSeconds()).isEqualTo(5);

        assertThat(start(InterviewMode.ONE_ON_ONE).getAnswerPauseSeconds()).as("default").isEqualTo(10);

        assertThatThrownBy(() -> service.start("Alex", null, null, company.getId(), InterviewMode.ONE_ON_ONE,
                RoundRequest.NONE, cv, 2))
                .isInstanceOfSatisfying(com.mockinterviewer.common.ValidationException.class,
                        e -> assertThat(e.getErrors()).containsKey("answerPauseSeconds"));
    }

    @Test
    void skippingTheIntroductionPlansOnlyMainQuestionsAndReattemptsKeepIt() throws Exception {
        when(ai.planInterview(any(), any())).thenReturn(List.of(
                new PlannedQuestion("Caching", "Design a cache?"),
                new PlannedQuestion("Queues", "Kafka vs SQS?"),
                new PlannedQuestion("Leadership", "Lead a migration?")));
        Interview started = service.start("Alex", null, null, company.getId(), InterviewMode.ONE_ON_ONE,
                RoundRequest.NONE, new FormatRequest(null, 3, false),
                new ResumeUpload("cv.txt", "text/plain", resumeBytes()), null);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<PlanSlot>> slots = ArgumentCaptor.forClass(List.class);
        verify(ai).planInterview(any(), slots.capture());
        assertThat(slots.getValue()).hasSize(3);
        assertThat(started.hasIntroduction()).isFalse();
        assertThat(started.getPlan()).extracting(InterviewQuestion::getTopic)
                .containsExactly("Caching", "Queues", "Leadership");
        assertThat(started.getPlannedQuestions()).isEqualTo(3);
        assertThat(started.getTurns()).singleElement().extracting(InterviewTurn::getQuestion).isEqualTo("Design a cache?");
        mvc.perform(get("/api/interviews/" + started.getId()))
                .andExpect(jsonPath("$.introduction").value(false))
                .andExpect(jsonPath("$.roundType").value("STANDARD"));

        service.end(started.getId());
        assertThat(service.reattempt(started.getId()).hasIntroduction()).isFalse();
    }

    @Test
    void questionCountIsChosenPerInterviewAndValidated() {
        ResumeUpload cv = new ResumeUpload("cv.txt", "text/plain", resumeBytes());
        when(ai.planInterview(any(), any())).thenAnswer(inv -> {
            List<PlanSlot> s = inv.getArgument(1);
            return s.stream().map(slot -> new PlannedQuestion("T", "Q?")).toList();
        });
        Interview started = service.start("Alex", null, null, company.getId(), InterviewMode.ONE_ON_ONE,
                RoundRequest.NONE, new FormatRequest(RoundType.STANDARD, 4, null), cv, null);
        assertThat(started.getPlan()).as("introduction plus 4").hasSize(5);
        assertThat(started.mainQuestions()).isEqualTo(4);

        assertThatThrownBy(() -> service.start("Alex", null, null, company.getId(), InterviewMode.ONE_ON_ONE,
                RoundRequest.NONE, new FormatRequest(null, Interview.MAX_QUESTIONS + 1, null), cv, null))
                .isInstanceOfSatisfying(com.mockinterviewer.common.ValidationException.class,
                        e -> assertThat(e.getErrors()).containsKey("questionCount"));
        assertThatThrownBy(() -> service.start("Alex", null, null, company.getId(), InterviewMode.ONE_ON_ONE,
                new RoundRequest(null, null, List.of("Kafka", "Redis", "Java Core")),
                new FormatRequest(null, 2, null), cv, null))
                .as("more topics than questions")
                .isInstanceOfSatisfying(com.mockinterviewer.common.ValidationException.class,
                        e -> assertThat(e.getErrors()).containsKey("topics"));
    }

    @Test
    void aCodingRoundHasTwoProblemsByDefaultEachInTheCodeEditor() {
        ResumeUpload cv = new ResumeUpload("cv.txt", "text/plain", resumeBytes());
        when(ai.planInterview(any(), any())).thenReturn(List.of(
                new PlannedQuestion("Introduction", "Tell me about yourself.", false, CodeEditor.NONE),
                // The AI asked for the whiteboard and SQL: coerced to the code editor in a general-purpose language.
                new PlannedQuestion("Hashing", "Two sum?", true, CodeEditor.SQL),
                new PlannedQuestion("Graphs", "Course schedule?", false, CodeEditor.PYTHON)));
        Interview started = service.start("Alex", null, null, company.getId(), InterviewMode.ONE_ON_ONE,
                RoundRequest.NONE, new FormatRequest(RoundType.CODING, null, null), cv, null);

        assertThat(started.isCodingRound()).isTrue();
        assertThat(started.mainQuestions()).isEqualTo(Interview.DEFAULT_CODING_PROBLEMS);
        assertThat(started.getPlan()).extracting(InterviewQuestion::getCodeLanguage)
                .containsExactly(null, CodeLanguage.JAVA, CodeLanguage.PYTHON);
        assertThat(started.getPlan()).extracting(InterviewQuestion::isWhiteboard).containsOnly(false);
        assertThat(started.maxFollowUps(1)).as("the AI decides; only a runaway limit applies")
                .isEqualTo(Interview.CODING_FOLLOW_UP_LIMIT);

        assertThatThrownBy(() -> service.start("Alex", null, null, company.getId(), InterviewMode.ONE_ON_ONE,
                RoundRequest.NONE, new FormatRequest(RoundType.CODING, Interview.MAX_CODING_PROBLEMS + 1, null), cv,
                null))
                .isInstanceOfSatisfying(com.mockinterviewer.common.ValidationException.class,
                        e -> assertThat(e.getErrors()).containsKey("questionCount"));
    }

    @Test
    void anInterviewAbandonedAtTheFirstQuestionCanStillBeReattempted() {
        Long id = start(InterviewMode.ONE_ON_ONE).getId();
        assertThatThrownBy(() -> service.reattempt(id)).as("still in progress").isInstanceOf(BadRequestException.class);

        Interview abandoned = service.end(id);
        assertThat(abandoned.getStatus()).isEqualTo(InterviewStatus.ABANDONED);
        assertThat(abandoned.getOverallScore()).isNull();
        assertThat(abandoned.canBeReattempted()).isTrue();

        Interview retake = service.reattempt(id);
        assertThat(retake.getPlan()).hasSize(3);
        assertThat(retake.getTurns()).singleElement().extracting(InterviewTurn::getQuestion).isEqualTo(PLAN.get(0));
    }

    @Test
    @SuppressWarnings("unchecked")
    void focusTopicsAreNormalisedAndEachMainQuestionIsAssignedOne() throws Exception {
        // "dsa" and "DSA" are the same catalog topic; "spring  boot" matches the catalog's "Spring Boot".
        Interview started = start(InterviewMode.ONE_ON_ONE,
                new RoundRequest(" Round 2 ", "Deep dive, no puzzles.", List.of("dsa", "spring  boot", "DSA", " ")));

        assertThat(started.getRoundName()).isEqualTo("Round 2");
        assertThat(started.getFocusTopics()).containsExactly("Data Structures & Algorithms", "Spring Boot");
        ArgumentCaptor<List<PlanSlot>> slots = ArgumentCaptor.forClass(List.class);
        verify(ai).planInterview(eq(started), slots.capture());
        assertThat(slots.getValue()).extracting(PlanSlot::topic)
                .containsExactly(null, "Data Structures & Algorithms", "Spring Boot");
        // The plan's labels are the topics themselves (not Claude's), so per-topic results add up.
        assertThat(started.getPlan()).extracting(InterviewQuestion::getTopic)
                .containsExactly("Introduction", "Data Structures & Algorithms", "Spring Boot");

        decide(NextAction.NEXT_QUESTION, 5, "");
        service.answer(started.getId(), "Hi, I'm Alex.", 10);
        decide(NextAction.FOLLOW_UP, 8, "What about eviction?");
        service.answer(started.getId(), "A hash map plus a linked list.", 10);
        service.skip(started.getId(), 5);

        mvc.perform(get("/api/interviews/" + started.getId()))
                .andExpect(jsonPath("$.roundName").value("Round 2"))
                .andExpect(jsonPath("$.roundDescription").value("Deep dive, no puzzles."))
                .andExpect(jsonPath("$.focusTopics.length()").value(2))
                .andExpect(jsonPath("$.topicResults[0].topic").value("Data Structures & Algorithms"))
                .andExpect(jsonPath("$.topicResults[0].answered").value(1))
                // The main answer scored 8, then the follow-up was skipped (0).
                .andExpect(jsonPath("$.topicResults[0].minScore").value(0))
                .andExpect(jsonPath("$.topicResults[0].maxScore").value(8))
                .andExpect(jsonPath("$.topicResults[0].lastScore").value(0))
                .andExpect(jsonPath("$.topicResults[1].minScore").doesNotExist())
                .andExpect(jsonPath("$.topicResults[1].maxScore").doesNotExist())
                .andExpect(jsonPath("$.topicResults[1].lastScore").doesNotExist());

        // Reattempts practise the same round.
        service.end(started.getId());
        Interview retake = service.reattempt(started.getId());
        assertThat(retake.getRoundName()).isEqualTo("Round 2");
        assertThat(retake.getFocusTopics()).containsExactly("Data Structures & Algorithms", "Spring Boot");
    }

    @Test
    void aRoundWithoutTopicsLeavesTheAreasToClaude() {
        Interview started = start(InterviewMode.ONE_ON_ONE, new RoundRequest("System design round", null, null));

        assertThat(started.getRoundName()).isEqualTo("System design round");
        assertThat(started.getFocusTopics()).isEmpty();
        assertThat(started.getPlan()).extracting(InterviewQuestion::getTopic)
                .containsExactly("Introduction", "Caching", "Leadership");
    }

    @Test
    void roundProblemsAreReportedWithTheOtherFieldErrors() throws Exception {
        // max-questions=2 here, so at most 2 topics.
        mvc.perform(multipart("/api/interviews")
                        .file(new MockMultipartFile("resume", "cv.txt", "text/plain", resumeBytes()))
                        .param("candidateName", "Alex")
                        .param("companyId", String.valueOf(company.getId()))
                        .param("mode", "ONE_ON_ONE")
                        .param("roundName", "x".repeat(101))
                        .param("topics", "Kafka", "Redis", "Docker"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.roundName").exists())
                .andExpect(jsonPath("$.errors.topics").value(containsString("at most 2")));
        verify(ai, never()).planInterview(any(), any());
    }

    @Test
    void aSingleTopicContainingCommasStaysOneTopic() throws Exception {
        mvc.perform(multipart("/api/interviews")
                        .file(new MockMultipartFile("resume", "cv.txt", "text/plain", resumeBytes()))
                        .param("candidateName", "Alex")
                        .param("companyId", String.valueOf(company.getId()))
                        .param("mode", "ONE_ON_ONE")
                        .param("topics", "observability (logs, metrics, tracing)"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.focusTopics.length()").value(1))
                .andExpect(jsonPath("$.focusTopics[0]").value("Observability (Logs, Metrics, Tracing)"));
    }

    @Test
    void slotTopicsAreContiguousBlocksWithEarlierTopicsTakingTheRemainder() {
        assertThat(InterviewService.slotTopics(List.of("A", "B", "C"), 5)).containsExactly("A", "A", "B", "B", "C");
        assertThat(InterviewService.slotTopics(List.of("A"), 3)).containsExactly("A", "A", "A");
        assertThat(InterviewService.slotTopics(List.of(), 3)).isEmpty();
    }

    /** Through HTTP, so the response is built after the transaction, as in production. */
    @Test
    void endingAndSkippingWithoutAnyAiCallStillReturnTheInterview() throws Exception {
        Long id = start(InterviewMode.ONE_ON_ONE).getId();
        mvc.perform(post("/api/interviews/" + id + "/end"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ABANDONED"))
                .andExpect(jsonPath("$.companyName").value(company.getName()));

        Long retakeId = service.reattempt(id).getId();
        mvc.perform(post("/api/interviews/" + retakeId + "/skip"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.interviewers[0].name").exists())
                .andExpect(jsonPath("$.questions[0].status").value("SKIPPED"))
                .andExpect(jsonPath("$.questions[1].status").value("CURRENT"));
    }

    private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0};

    @Test
    void whiteboardQuestionsAreFlaggedInThePlanAndCopiedByReattempts() throws Exception {
        when(ai.planInterview(any(), any())).thenReturn(List.of(
                new PlannedQuestion("Hello", PLAN.get(0), true), // never on the introduction
                new PlannedQuestion("Caching", PLAN.get(1), true),
                new PlannedQuestion("Leadership", PLAN.get(2), false)));
        Interview started = start(InterviewMode.ONE_ON_ONE);
        assertThat(started.getPlan()).extracting(InterviewQuestion::isWhiteboard).containsExactly(false, true, false);

        decide(NextAction.NEXT_QUESTION, 6, "");
        Interview i = service.answer(started.getId(), "Hi, I'm Alex.", 30);
        assertThat(i.getTurns().getLast().isWhiteboardRequested()).isTrue();
        mvc.perform(get("/api/interviews/" + i.getId()))
                .andExpect(jsonPath("$.turns[0].whiteboardRequested").value(false))
                .andExpect(jsonPath("$.turns[1].whiteboardRequested").value(true));

        service.end(i.getId());
        Interview again = service.reattempt(i.getId());
        assertThat(again.getPlan()).extracting(InterviewQuestion::isWhiteboard).containsExactly(false, true, false);
    }

    @Test
    void answersCarryTheWhiteboardAndADrawingAloneIsAnAnswer() throws Exception {
        Long id = start(InterviewMode.ONE_ON_ONE).getId();
        when(ai.nextTurn(any(), any(), anyBoolean(), anyBoolean()))
                .thenReturn(new TurnDecision(6, "ok", NextAction.FOLLOW_UP, "Add a cache to your diagram?", true));
        String board = java.util.Base64.getEncoder().encodeToString(PNG);

        mvc.perform(post("/api/interviews/" + id + "/answers").contentType("application/json")
                        .content("{\"answer\":\"Here is my design.\",\"whiteboard\":{\"png\":\"" + board
                                + "\",\"scene\":\"{}\",\"outline\":\"Boxes: API, DB\"}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.turns[0].whiteboardUrl").value(containsString("/whiteboard.png")))
                .andExpect(jsonPath("$.turns[1].whiteboardRequested").value(true));

        Interview i = service.get(id);
        Long turnId = i.getTurns().getFirst().getId();
        mvc.perform(get("/api/interviews/" + id + "/turns/" + turnId + "/whiteboard.png"))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content().bytes(PNG));
        mvc.perform(get("/api/interviews/" + id + "/turns/" + turnId + "/whiteboard/scene"))
                .andExpect(status().isOk());

        // Only a drawing: accepted. Neither words nor a drawing: rejected. Not a PNG: rejected.
        decide(NextAction.NEXT_QUESTION, 5, "");
        mvc.perform(post("/api/interviews/" + id + "/answers").contentType("application/json")
                        .content("{\"answer\":\"\",\"whiteboard\":{\"png\":\"bm90IGEgcG5n\"}}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/interviews/" + id + "/answers").contentType("application/json")
                        .content("{\"answer\":\"  \"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/interviews/" + id + "/answers").contentType("application/json")
                        .content("{\"answer\":\"\",\"whiteboard\":{\"png\":\"" + board + "\"}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.turns[1].answer").value(InterviewService.WHITEBOARD_ONLY_ANSWER))
                .andExpect(jsonPath("$.turns[1].whiteboardUrl").exists());
    }

    @Test
    void codeQuestionsAreFlaggedInThePlanAndCopiedByReattempts() throws Exception {
        when(ai.planInterview(any(), any())).thenReturn(List.of(
                new PlannedQuestion("Hello", PLAN.get(0), false, CodeEditor.PYTHON), // never on the introduction
                new PlannedQuestion("Caching", PLAN.get(1), false, CodeEditor.SQL),
                new PlannedQuestion("Leadership", PLAN.get(2), true, CodeEditor.JAVA))); // the whiteboard wins
        Interview started = start(InterviewMode.ONE_ON_ONE);
        assertThat(started.getPlan()).extracting(InterviewQuestion::getCodeLanguage)
                .containsExactly(null, CodeLanguage.SQL, null);

        decide(NextAction.NEXT_QUESTION, 6, "");
        Interview i = service.answer(started.getId(), "Hi, I'm Alex.", 30);
        assertThat(i.getTurns().getLast().getCodeRequested()).isEqualTo(CodeLanguage.SQL);
        mvc.perform(get("/api/interviews/" + i.getId()))
                .andExpect(jsonPath("$.turns[0].codeRequested").doesNotExist())
                .andExpect(jsonPath("$.turns[1].codeRequested").value("SQL"))
                .andExpect(jsonPath("$.questions[1].codeLanguage").value("SQL"));

        service.end(i.getId());
        Interview again = service.reattempt(i.getId());
        assertThat(again.getPlan()).extracting(InterviewQuestion::getCodeLanguage)
                .containsExactly(null, CodeLanguage.SQL, null);
    }

    @Test
    void answersCarryCodeAndCodeAloneIsAnAnswer() throws Exception {
        Long id = start(InterviewMode.ONE_ON_ONE).getId();
        when(ai.nextTurn(any(), any(), anyBoolean(), anyBoolean())).thenReturn(new TurnDecision(6, "ok",
                NextAction.FOLLOW_UP, "Can you make it O(n)?", false, CodeEditor.PYTHON));

        mvc.perform(post("/api/interviews/" + id + "/answers").contentType("application/json")
                        .content("{\"answer\":\"Here is my solution.\",\"code\":{\"language\":\"PYTHON\","
                                + "\"source\":\"def f(xs):\\n    return sorted(xs)\"}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.turns[0].code.language").value("PYTHON"))
                .andExpect(jsonPath("$.turns[0].code.source").value("def f(xs):\n    return sorted(xs)"))
                .andExpect(jsonPath("$.questions[0].code.language").value("PYTHON"))
                .andExpect(jsonPath("$.turns[1].codeRequested").value("PYTHON"));

        // The code goes to the AI with the answer.
        ArgumentCaptor<Interview> seen = ArgumentCaptor.forClass(Interview.class);
        verify(ai).nextTurn(seen.capture(), any(), anyBoolean(), anyBoolean());
        assertThat(seen.getValue().getTurns().getFirst().getCode().getSource()).contains("sorted(xs)");

        // Too long, or no language: rejected. Only code: accepted.
        decide(NextAction.NEXT_QUESTION, 5, "");
        String tooLong = "x".repeat(TurnCode.MAX_SOURCE_CHARS + 1);
        mvc.perform(post("/api/interviews/" + id + "/answers").contentType("application/json")
                        .content("{\"answer\":\"\",\"code\":{\"language\":\"JAVA\",\"source\":\"" + tooLong + "\"}}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/interviews/" + id + "/answers").contentType("application/json")
                        .content("{\"answer\":\"\",\"code\":{\"source\":\"select 1\"}}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/interviews/" + id + "/answers").contentType("application/json")
                        .content("{\"answer\":\"\",\"code\":{\"language\":\"SQL\",\"source\":\"select 1\"}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.turns[1].answer").value(InterviewService.CODE_ONLY_ANSWER))
                .andExpect(jsonPath("$.turns[1].code.language").value("SQL"));
    }

    @Test
    void theAiChoosesThePanelAndWhoAsksEachSlotFromTheWholeCompany() {
        Interviewer kai = interviewers.save(new Interviewer("Kai", "Principal Engineer", 15, "Kafka, streaming", "",
                null, company));
        when(ai.assignPanel(any(), any(), anyInt(), any())).thenReturn(new PanelAssignment("Kafka round",
                List.of(kai.getId()), List.of(kai.getId(), kai.getId(), kai.getId())));

        Interview started = start(InterviewMode.ONE_ON_ONE);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Interviewer>> roster = ArgumentCaptor.forClass(List.class);
        verify(ai).assignPanel(any(), roster.capture(), eq(1), eq(List.of()));
        assertThat(roster.getValue()).extracting(Interviewer::getName).containsExactly("Kai", "Priya", "Sam");
        assertThat(started.getInterviewers()).extracting(Interviewer::getName).containsExactly("Kai");
        assertThat(started.getPlan()).extracting(q -> q.getAskedBy().getName()).containsExactly("Kai", "Kai", "Kai");
    }

    @Test
    void aCompanyWithOneInterviewerLeavesNothingForTheAiToChoose() {
        Company solo = companies.save(new Company("Solo " + System.nanoTime(), "", "", "", null));
        interviewers.save(new Interviewer("Lee", "Engineer", 5, "", "", null, solo));

        Interview started = service.start("Alex", "Backend Engineer", null, solo.getId(), InterviewMode.ONE_ON_ONE,
                RoundRequest.NONE, new ResumeUpload("cv.txt", "text/plain", resumeBytes()));

        verify(ai, never()).assignPanel(any(), any(), anyInt(), any());
        assertThat(started.getInterviewers()).extracting(Interviewer::getName).containsExactly("Lee");
    }

    private Interview start(InterviewMode mode) {
        return start(mode, RoundRequest.NONE);
    }

    private Interview start(InterviewMode mode, RoundRequest round) {
        return service.start("Alex", "Backend Engineer", null, company.getId(), mode, round,
                new ResumeUpload("cv.txt", "text/plain", resumeBytes()));
    }

    private void decide(NextAction action, int score, String followUp) {
        when(ai.nextTurn(any(), any(), anyBoolean(), anyBoolean()))
                .thenReturn(new TurnDecision(score, "ok", action, followUp));
    }

    private static byte[] resumeBytes() {
        return "Alex - backend engineer, 5 years of Java and Spring, built payment APIs and led a migration."
                .getBytes(StandardCharsets.UTF_8);
    }
}
