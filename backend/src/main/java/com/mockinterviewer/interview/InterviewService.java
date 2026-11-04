package com.mockinterviewer.interview;

import com.mockinterviewer.ai.AiOutputs.FinalEvaluation;
import com.mockinterviewer.ai.AiOutputs.PanelAssignment;
import com.mockinterviewer.ai.AiOutputs.PlannedQuestion;
import com.mockinterviewer.ai.AiOutputs.StudyGuide;
import com.mockinterviewer.ai.AiOutputs.StudyTopic;
import com.mockinterviewer.ai.AiOutputs.NextAction;
import com.mockinterviewer.ai.AiOutputs.TurnDecision;
import com.mockinterviewer.ai.InterviewAi;
import com.mockinterviewer.ai.InterviewAi.PlanSlot;
import com.mockinterviewer.common.AiResponseException;
import com.mockinterviewer.common.BadRequestException;
import com.mockinterviewer.common.NotFoundException;
import com.mockinterviewer.common.ValidationException;
import com.mockinterviewer.company.Company;
import com.mockinterviewer.company.CompanyService;
import com.mockinterviewer.config.AiProperties;
import com.mockinterviewer.interviewer.Interviewer;
import com.mockinterviewer.interviewer.InterviewerService;
import com.mockinterviewer.topic.TopicCatalog;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.hibernate.Hibernate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Drives the interview state machine. Code owns the structure (who speaks, how many questions and follow-ups);
 * Claude owns the content (question wording, scores, feedback) and picks among the actions code allows.
 *
 * AI calls run inside the transaction on purpose: if Claude fails, nothing is persisted and the
 * candidate can simply retry the same request.
 */
@Service
@Transactional
public class InterviewService {

    private static final Logger log = LoggerFactory.getLogger(InterviewService.class);

    private static final long MAX_RESUME_BYTES = 10L * 1024 * 1024;
    private static final int MIN_RESUME_TEXT_CHARS = 50;
    private static final int MAX_NAME_CHARS = 100;
    private static final int MAX_ROLE_CHARS = 150;
    private static final int MIN_JOB_DESCRIPTION_CHARS = 50;
    private static final int MAX_JOB_DESCRIPTION_CHARS = 20_000;
    private static final int MAX_ROUND_NAME_CHARS = 100;
    private static final int MAX_ROUND_DESCRIPTION_CHARS = 2_000;

    private final InterviewRepository interviews;
    private final CompanyService companies;
    private final InterviewerService interviewers;
    private final InterviewerAssigner assigner;
    private final InterviewAi ai;
    private final AiProperties props;

    public InterviewService(InterviewRepository interviews, CompanyService companies,
            InterviewerService interviewers, InterviewerAssigner assigner, InterviewAi ai, AiProperties props) {
        this.interviews = interviews;
        this.companies = companies;
        this.interviewers = interviewers;
        this.assigner = assigner;
        this.ai = ai;
        this.props = props;
    }

    public record ResumeUpload(String fileName, String contentType, byte[] data) {
    }

    /** The round being practised; every part is optional. {@code topics} restricts the main questions. */
    public record RoundRequest(String name, String description, List<String> topics) {

        public static final RoundRequest NONE = new RoundRequest(null, null, List.of());
    }

    /**
     * Checks every input (reporting all problems at once), has the AI choose the interviewers and who asks each
     * slot from the full context ({@link InterviewAi#assignPanel}, kept legal by {@link InterviewerAssigner}), then
     * plan the whole interview: the introduction plus {@code max-questions} main questions, each, when the round
     * has focus topics, on one of them ({@link #slotTopics}). The plan is stored before the first question is
     * asked.
     */
    public Interview start(String candidateName, String targetRole, String jobDescription, Long companyId,
            InterviewMode mode, RoundRequest round, ResumeUpload resume) {
        return start(candidateName, targetRole, jobDescription, companyId, mode, round, resume, null);
    }

    /** As above, with the hands-free pause (seconds of silence before an answer is submitted; null = default). */
    public Interview start(String candidateName, String targetRole, String jobDescription, Long companyId,
            InterviewMode mode, RoundRequest round, ResumeUpload resume, Integer answerPauseSeconds) {
        Map<String, String> errors = new LinkedHashMap<>();
        if (answerPauseSeconds != null && (answerPauseSeconds < Interview.MIN_ANSWER_PAUSE_SECONDS
                || answerPauseSeconds > Interview.MAX_ANSWER_PAUSE_SECONDS)) {
            errors.put("answerPauseSeconds", "Choose a pause between " + Interview.MIN_ANSWER_PAUSE_SECONDS + " and "
                    + Interview.MAX_ANSWER_PAUSE_SECONDS + " seconds.");
        }
        String name = blankToNull(candidateName);
        if (name == null) {
            errors.put("candidateName", "Enter your name.");
        } else if (name.length() > MAX_NAME_CHARS) {
            errors.put("candidateName", "Name must be " + MAX_NAME_CHARS + " characters or fewer.");
        }
        String role = blankToNull(targetRole);
        if (role != null && role.length() > MAX_ROLE_CHARS) {
            errors.put("targetRole", "Target role must be " + MAX_ROLE_CHARS + " characters or fewer.");
        }
        String jd = blankToNull(jobDescription);
        if (jd != null && jd.length() > MAX_JOB_DESCRIPTION_CHARS) {
            errors.put("jobDescription", "Job description must be " + MAX_JOB_DESCRIPTION_CHARS
                    + " characters or fewer.");
        } else if (jd != null && jd.length() < MIN_JOB_DESCRIPTION_CHARS) {
            errors.put("jobDescription", "That's too short to be a job description (at least "
                    + MIN_JOB_DESCRIPTION_CHARS + " characters). Paste the full posting or leave it empty.");
        }
        if (round == null) {
            round = RoundRequest.NONE;
        }
        String roundName = blankToNull(round.name());
        if (roundName != null && roundName.length() > MAX_ROUND_NAME_CHARS) {
            errors.put("roundName", "Round name must be " + MAX_ROUND_NAME_CHARS + " characters or fewer.");
        }
        String roundDescription = blankToNull(round.description());
        if (roundDescription != null && roundDescription.length() > MAX_ROUND_DESCRIPTION_CHARS) {
            errors.put("roundDescription", "Round description must be " + MAX_ROUND_DESCRIPTION_CHARS
                    + " characters or fewer.");
        }
        List<String> topics = focusTopics(round.topics(), errors);
        if (mode == null) {
            errors.put("mode", "Choose one-on-one or panel.");
        }
        Company company = companies.findById(companyId).orElse(null);
        if (companyId == null) {
            errors.put("companyId", "Choose a company.");
        } else if (company == null) {
            errors.put("companyId", "That company no longer exists. Choose another.");
        } else {
            long available = interviewers.countForCompany(companyId);
            if (available == 0) {
                errors.put("companyId", company.getName() + " has no interviewers yet. Add one on its company page.");
            } else if (mode == InterviewMode.PANEL && available < 2) {
                errors.put("companyId", company.getName() + " has only one interviewer, but a panel needs at "
                        + "least 2. Add another, or choose one-on-one.");
            }
        }
        String contentType = checkResume(resume, errors);
        if (!errors.isEmpty()) {
            throw new ValidationException(errors);
        }

        Interview interview = new Interview(name, role, jd, company, mode, List.of(), resume.fileName(), contentType,
                resume.data());
        interview.defineRound(roundName, roundDescription, topics);
        interview.setAnswerPauseSeconds(answerPauseSeconds);
        // Slot 1 is the introduction; with focus topics, each main question covers one of them.
        List<String> slotTopics = slotTopics(topics, props.maxQuestions());
        int slotCount = props.maxQuestions() + 1;

        // The AI picks the panel and who asks each slot from the full context; the assigner keeps it legal.
        List<Interviewer> roster = interviewers.forCompany(companyId);
        PanelAssignment choice = roster.size() > 1
                ? ai.assignPanel(interview, roster, assigner.panelSize(mode, roster.size()), slotTopics)
                : null;
        if (choice != null) {
            log.debug("Panel choice for {} at {}: {}", name, company.getName(), choice.reasoning());
        }
        InterviewerAssigner.Assignment assignment = assigner.resolve(choice, roster, mode, slotCount);
        List<Interviewer> panel = assignment.panel();
        interview.assignPanel(panel);
        List<PlanSlot> slots = new ArrayList<>();
        for (int i = 0; i < slotCount; i++) {
            slots.add(new PlanSlot(assignment.askers().get(i), i == 0 || slotTopics.isEmpty() ? null : slotTopics.get(i - 1)));
        }
        List<PlannedQuestion> planned = ai.planInterview(interview, slots);
        for (int i = 0; i < slots.size(); i++) {
            PlanSlot slot = slots.get(i);
            // With focus topics the label is the topic itself, so per-topic results add up.
            String topic = i == 0 ? "Introduction" : slot.topic() != null ? slot.topic() : blankToNull(planned.get(i).topic());
            interview.plan(slot.askedBy(), topic, planned.get(i).question().strip(), i > 0 && planned.get(i).whiteboard());
        }
        interview.ask(interview.getPlan().getFirst());
        Interview saved = interviews.save(interview);
        log.info("Interview {} started: {}, {} with {}, {} questions planned, round {}, topics {}", saved.getId(),
                company.getName(), mode, panel.stream().map(Interviewer::getName).toList(), saved.getPlan().size(),
                roundName == null ? "unnamed" : '"' + roundName + '"', topics);
        return initialised(saved);
    }

    /** Name and resume from the most recent interview: the defaults the assistant uses to start a new one. */
    public record LatestProfile(String candidateName, String targetRole, ResumeUpload resume) {
    }

    @Transactional(readOnly = true)
    public Optional<LatestProfile> latestProfile() {
        return interviews.findFirstByOrderByStartedAtDesc().map(i -> new LatestProfile(i.getCandidateName(),
                i.getTargetRole(), new ResumeUpload(i.getResumeFileName(), i.getResumeContentType(), i.getResumeData())));
    }

    /** A resume as used by one interview, for the assistant's resume tools. */
    public record UsedResume(Long interviewId, String candidateName, String targetRole, String company,
            java.time.Instant startedAt, ResumeUpload resume) {
    }

    /** The resume an interview used: {@code interviewId}'s, or the most recent interview's when null. */
    @Transactional(readOnly = true)
    public Optional<UsedResume> resumeOf(Long interviewId) {
        Optional<Interview> found = interviewId == null ? interviews.findFirstByOrderByStartedAtDesc()
                : interviews.findById(interviewId);
        return found.map(InterviewService::usedResume);
    }

    /** Every interview's resume, newest interview first (callers group identical files). */
    @Transactional(readOnly = true)
    public List<UsedResume> usedResumes() {
        return interviews.findAllByOrderByStartedAtDesc().stream().map(InterviewService::usedResume).toList();
    }

    private static UsedResume usedResume(Interview i) {
        return new UsedResume(i.getId(), i.getCandidateName(), i.getTargetRole(), i.getCompany().getName(),
                i.getStartedAt(), new ResumeUpload(i.getResumeFileName(), i.getResumeContentType(), i.getResumeData()));
    }

    @Transactional(readOnly = true)
    public Interview get(Long id) {
        return initialised(find(id));
    }

    @Transactional(readOnly = true)
    public List<Interview> list(List<InterviewStatus> statuses) {
        List<Interview> found = interviews.findByStatusIn(statuses);
        // The summaries count turns and the plan; load them while the session is open.
        found.forEach(i -> {
            Hibernate.initialize(i.getTurns());
            Hibernate.initialize(i.getPlan());
            Hibernate.initialize(i.getFocusTopics());
        });
        return found;
    }

    /**
     * Records the answer, then Claude scores it and either probes it with a follow-up or moves on; the next main
     * question always comes from the plan.
     */
    public Interview answer(Long id, String answerText, Integer responseSeconds) {
        return answer(id, answerText, responseSeconds, null);
    }

    /** The whiteboard as drawn when the answer was submitted: PNG bytes, Excalidraw scene JSON and a text outline. */
    public record WhiteboardUpload(byte[] png, String scene, String outline) {
    }

    /**
     * As above, with the candidate's whiteboard (null if they didn't draw). With a drawing the spoken or typed
     * answer may be empty: the board is the answer.
     */
    public Interview answer(Long id, String answerText, Integer responseSeconds, WhiteboardUpload whiteboard) {
        Interview interview = requireInProgress(id);
        InterviewTurn current = interview.pendingTurn()
                .orElseThrow(() -> new BadRequestException("There is no question waiting for an answer."));
        TurnWhiteboard board = whiteboard(whiteboard);
        String text = answerText == null ? "" : answerText.strip();
        if (text.isEmpty() && board == null) {
            throw new BadRequestException("Type or say an answer, or draw it on the whiteboard.");
        }
        current.recordAnswer(text.isEmpty() ? WHITEBOARD_ONLY_ANSWER : text, responseSeconds, board);

        boolean followUpAllowed = interview.followUpsOnCurrentQuestion() < props.maxFollowUps();
        Optional<InterviewQuestion> next = interview.nextPlannedQuestion();
        // Follow-ups come from whoever asked the planned question being discussed.
        Interviewer followUpSpeaker = interview.currentQuestion().map(InterviewQuestion::getAskedBy)
                .orElse(current.getAskedBy());

        TurnDecision decision = ai.nextTurn(interview, followUpSpeaker, followUpAllowed, next.isPresent());
        current.recordEvaluation(clamp(decision.score(), 0, 10), decision.feedback());
        logAnswered(interview, current);

        switch (resolveAction(decision.nextAction(), followUpAllowed, next.isPresent())) {
            case FOLLOW_UP -> interview.askFollowUp(followUpSpeaker, requireQuestion(decision), decision.whiteboard());
            case NEXT_QUESTION -> interview.ask(next.orElseThrow());
            case END -> finish(interview);
        }
        return initialised(interview);
    }

    /** Starts a new attempt with the original's plan: the same main questions, in the same order. */
    public Interview reattempt(Long id) {
        Interview original = originalOf(find(id));
        if (!original.canBeReattempted()) {
            throw new BadRequestException(original.getStatus() == InterviewStatus.IN_PROGRESS
                    ? "Finish or end this interview before reattempting it."
                    : "This interview has no questions to replay.");
        }
        Interview attempt = Interview.reattempt(original, interviews.maxAttempt(original) + 1);
        attempt.ask(attempt.getPlan().getFirst());
        Interview saved = interviews.save(attempt);
        log.info("Interview {} started: attempt {} of interview {} ({} questions)", saved.getId(),
                saved.getAttempt(), original.getId(), saved.getPlan().size());
        return initialised(saved);
    }

    /** The original interview and all its reattempts, in attempt order. */
    @Transactional(readOnly = true)
    public List<Interview> attempts(Long id) {
        Interview original = originalOf(find(id));
        List<Interview> all = new ArrayList<>();
        all.add(original);
        all.addAll(interviews.findByRetakeOfOrderByAttempt(original));
        return all;
    }

    /**
     * Candidate skips the waiting question (main or follow-up): it scores 0 and the next planned question is
     * asked. No AI call is needed.
     */
    public Interview skip(Long id, Integer responseSeconds) {
        Interview interview = requireInProgress(id);
        InterviewTurn current = interview.pendingTurn()
                .orElseThrow(() -> new BadRequestException("There is no question waiting for an answer."));
        current.recordSkip(responseSeconds);
        log.info("Interview {} question {} skipped after {}", interview.getId(), current.getSequence(),
                seconds(responseSeconds));
        interview.nextPlannedQuestion().ifPresentOrElse(interview::ask, () -> finishOrAbandon(interview));
        return initialised(interview);
    }

    /**
     * Initialises the lazy associations the DTOs read, while the session is still open. Every method that returns
     * an interview to the controller must go through this: paths that never call the AI (abandoning, skipping in a
     * reattempt) otherwise leave the company and panel as proxies and the response fails after the commit.
     */
    private static Interview initialised(Interview interview) {
        interview.getCompany().getName();
        interview.getInterviewers().size();
        interview.getFocusTopics().size();
        interview.getPlan().forEach(q -> q.getAskedBy().getName());
        interview.getTurns().forEach(t -> {
            t.getAskedBy().getName();
            Hibernate.initialize(t.getPlannedQuestion());
        });
        return interview;
    }

    /** The original interview, loaded (not a lazy proxy) so callers can use it after the transaction. */
    private static Interview originalOf(Interview interview) {
        return interview.isReattempt() ? (Interview) Hibernate.unproxy(interview.getRetakeOf()) : interview;
    }

    /**
     * "Ask AI" for a main question of an ended interview: a model answer and reading list, generated on first request
     * and stored on the planned question (each attempt has its own plan rows, so each attempt gets its own).
     */
    public StudyGuideNotes studyGuide(Long id, Long questionId) {
        Interview interview = requireEnded(id);
        InterviewQuestion question = interview.getPlan().stream()
                .filter(q -> q.getId().equals(questionId))
                .findFirst()
                .orElseThrow(() -> new NotFoundException("Question", questionId));
        if (question.getStudyGuide() != null) {
            return question.getStudyGuide();
        }
        InterviewTurn main = interview.getTurns().stream()
                .filter(t -> !t.isFollowUp() && t.getPlannedQuestion() != null
                        && questionId.equals(t.getPlannedQuestion().getId()))
                .findFirst().orElse(null);
        String outcome = main == null || main.isDropped() ? "not reached"
                : main.isAnswered() ? "answered" : main.isSkipped() ? "skipped" : "not reached";

        long startedNanos = System.nanoTime();
        StudyGuideNotes notes = notes(ai.studyGuide(interview, question, outcome));
        question.recordStudyGuide(notes);
        log.info("Interview {} question {} study guide ({}) generated in {} ms", id, question.getPosition(), outcome,
                (System.nanoTime() - startedNanos) / 1_000_000);
        return notes;
    }

    /** "Ask AI" for an answered or skipped follow-up of an ended interview; stored on the follow-up turn. */
    public StudyGuideNotes followUpStudyGuide(Long id, Long turnId) {
        Interview interview = requireEnded(id);
        InterviewTurn followUp = interview.getTurns().stream()
                .filter(t -> t.getId().equals(turnId) && t.isFollowUp() && t.getPlannedQuestion() != null)
                .findFirst()
                .orElseThrow(() -> new NotFoundException("Follow-up", turnId));
        if (followUp.getStudyGuide() != null) {
            return followUp.getStudyGuide();
        }
        if (!followUp.isResolved()) {
            throw new BadRequestException("This follow-up was never answered or skipped.");
        }
        InterviewQuestion question = followUp.getPlannedQuestion();
        int number = 1 + (int) interview.getTurns().stream()
                .filter(t -> t.isFollowUp() && t.getSequence() < followUp.getSequence()
                        && t.getPlannedQuestion() != null && question.getId().equals(t.getPlannedQuestion().getId()))
                .count();
        String outcome = followUp.isAnswered() ? "answered" : "skipped";

        long startedNanos = System.nanoTime();
        StudyGuideNotes notes = notes(ai.followUpStudyGuide(interview, followUp, number, outcome));
        followUp.recordStudyGuide(notes);
        log.info("Interview {} question {} follow-up {} study guide ({}) generated in {} ms", id,
                question.getPosition(), number, outcome, (System.nanoTime() - startedNanos) / 1_000_000);
        return notes;
    }

    private static StudyGuideNotes notes(StudyGuide guide) {
        List<StudyTopic> topics = guide.studyTopics() == null ? List.of() : guide.studyTopics();
        return new StudyGuideNotes(guide.modelAnswer(), topics.stream()
                .filter(t -> t.topic() != null && !t.topic().isBlank())
                .map(t -> new String[] {t.topic(), t.reason()})
                .toList());
    }

    /** Candidate ends the interview early. The unanswered question, if any, is dropped. */
    public Interview end(Long id) {
        Interview interview = requireInProgress(id);
        interview.dropPendingTurn();
        finishOrAbandon(interview);
        return initialised(interview);
    }

    /** Scores the interview, or abandons it if every question was skipped (nothing to evaluate). */
    private void finishOrAbandon(Interview interview) {
        if (interview.hasAnsweredTurns()) {
            finish(interview);
        } else {
            interview.abandon();
            log.info("Interview {} abandoned after {} with no answers", interview.getId(),
                    seconds(interview.durationSeconds()));
        }
    }

    private static void logAnswered(Interview interview, InterviewTurn turn) {
        log.info("Interview {} question {}{} answered in {}, score {}/10", interview.getId(), turn.getSequence(),
                turn.isFollowUp() ? " (follow-up)" : "", seconds(turn.getResponseSeconds()), turn.getScore());
    }

    /** "1m 05s" style, or "unknown time" when the browser didn't send a timing. */
    static String seconds(Number value) {
        if (value == null) {
            return "unknown time";
        }
        long s = value.longValue();
        return s >= 60 ? String.format("%dm %02ds", s / 60, s % 60) : s + "s";
    }

    /**
     * Deletes the whole interview: the original and every reattempt, whichever attempt's id is given. Single
     * attempts can't be deleted on their own.
     */
    public void delete(Long id) {
        Interview original = originalOf(find(id));
        interviews.deleteAll(interviews.findByRetakeOfOrderByAttempt(original));
        interviews.delete(original);
    }

    private void finish(Interview interview) {
        FinalEvaluation eval = ai.finalEvaluation(interview);
        interview.complete(clamp(eval.overallScore(), 0, 100), eval.summary(),
                nullToEmpty(eval.strengths()), nullToEmpty(eval.improvements()));
        log.info("Interview {} completed: score {}/100, {}/{} questions attempted, session {}, answering {}",
                interview.getId(), interview.getOverallScore(), interview.attemptedQuestions(),
                interview.getPlannedQuestions(), seconds(interview.durationSeconds()),
                seconds(interview.answeringSeconds()));
    }

    /**
     * Normalises the requested focus topics into {@code errors}: catalog names where they match, blanks and
     * duplicates dropped, order kept (it is the priority order).
     */
    private List<String> focusTopics(List<String> requested, Map<String, String> errors) {
        if (requested == null) {
            return List.of();
        }
        List<String> topics = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String raw : requested) {
            String t = blankToNull(raw);
            if (t == null) {
                continue;
            }
            if (t.length() > TopicCatalog.MAX_TOPIC_CHARS) {
                errors.put("topics", "Each topic must be " + TopicCatalog.MAX_TOPIC_CHARS + " characters or fewer.");
                return List.of();
            }
            String canonical = TopicCatalog.canonical(t);
            if (seen.add(TopicCatalog.key(canonical))) {
                topics.add(canonical);
            }
        }
        int max = TopicCatalog.maxTopics(props.maxQuestions());
        if (topics.size() > max) {
            errors.put("topics", "Choose at most " + max + " topics: each one needs at least one of the "
                    + props.maxQuestions() + " main questions.");
        }
        return topics;
    }

    /**
     * The focus topic for each main question, in plan order: contiguous blocks in the order the topics were
     * given, with earlier topics taking the extra questions when they don't divide evenly (5 questions over
     * 3 topics is A, A, B, B, C). Empty when there are no focus topics.
     */
    static List<String> slotTopics(List<String> topics, int mainQuestions) {
        List<String> slots = new ArrayList<>();
        if (topics.isEmpty()) {
            return slots;
        }
        int n = Math.min(topics.size(), mainQuestions);
        for (int t = 0; t < n; t++) {
            int count = mainQuestions / n + (t < mainQuestions % n ? 1 : 0);
            for (int c = 0; c < count; c++) {
                slots.add(topics.get(t));
            }
        }
        return slots;
    }

    /** Claude must choose from the allowed actions; if it doesn't, fall back to the natural next step. */
    static NextAction resolveAction(NextAction requested, boolean followUpAllowed, boolean nextQuestionAllowed) {
        if (requested == NextAction.FOLLOW_UP && followUpAllowed) {
            return NextAction.FOLLOW_UP;
        }
        return nextQuestionAllowed ? NextAction.NEXT_QUESTION : NextAction.END;
    }

    private Interview find(Long id) {
        return interviews.findById(id).orElseThrow(() -> new NotFoundException("Interview", id));
    }

    /** Coaching is only for ended interviews, so it can't be used to look answers up mid-interview. */
    private Interview requireEnded(Long id) {
        Interview interview = find(id);
        if (interview.getStatus() == InterviewStatus.IN_PROGRESS) {
            throw new BadRequestException("Ask AI is available once the interview has ended.");
        }
        return interview;
    }

    private Interview requireInProgress(Long id) {
        Interview interview = find(id);
        if (interview.getStatus() != InterviewStatus.IN_PROGRESS) {
            throw new BadRequestException("This interview has already ended.");
        }
        return interview;
    }

    /** Validates the resume into {@code errors}; returns the normalised content type (null if invalid). */
    private static String checkResume(ResumeUpload resume, Map<String, String> errors) {
        if (resume == null || resume.data() == null || resume.data().length == 0) {
            errors.put("resume", "Upload your resume.");
            return null;
        }
        if (resume.data().length > MAX_RESUME_BYTES) {
            errors.put("resume", "Resume must be 10 MB or smaller.");
            return null;
        }
        String name = resume.fileName() == null ? "" : resume.fileName().toLowerCase();
        String type = resume.contentType() == null ? "" : resume.contentType().toLowerCase();
        if (type.equals("application/pdf") || name.endsWith(".pdf")) {
            if (!startsWith(resume.data(), "%PDF-")) {
                errors.put("resume", "That file isn't a valid PDF. Export your resume to PDF again, or upload text.");
                return null;
            }
            return "application/pdf";
        }
        if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
            String text;
            try {
                text = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(resume.data())).toString();
            } catch (CharacterCodingException e) {
                errors.put("resume", "That text file isn't readable (it must be UTF-8 text).");
                return null;
            }
            if (text.replaceAll("\\s", "").length() < MIN_RESUME_TEXT_CHARS) {
                errors.put("resume", "That resume looks empty. Upload the full resume.");
                return null;
            }
            return "text/plain";
        }
        errors.put("resume", "Resume must be a PDF or a plain-text (.txt/.md) file.");
        return null;
    }

    private static boolean startsWith(byte[] data, String prefix) {
        byte[] p = prefix.getBytes(StandardCharsets.ISO_8859_1);
        if (data.length < p.length) {
            return false;
        }
        for (int i = 0; i < p.length; i++) {
            if (data[i] != p[i]) {
                return false;
            }
        }
        return true;
    }

    /** Stored as the answer text when the candidate only drew. */
    static final String WHITEBOARD_ONLY_ANSWER = "(Answered on the whiteboard.)";

    private static TurnWhiteboard whiteboard(WhiteboardUpload upload) {
        if (upload == null || upload.png() == null || upload.png().length == 0) {
            return null;
        }
        if (upload.png().length > TurnWhiteboard.MAX_PNG_BYTES) {
            throw new BadRequestException("The whiteboard image is too large. Simplify the drawing and try again.");
        }
        if (!startsWith(upload.png(), "\u0089PNG\r\n\u001a\n")) {
            throw new BadRequestException("The whiteboard image isn't a PNG.");
        }
        String scene = blankToNull(upload.scene());
        if (scene != null && scene.length() > TurnWhiteboard.MAX_SCENE_CHARS) {
            scene = null; // only used to reopen the board; the image is what counts
        }
        String outline = blankToNull(upload.outline());
        if (outline != null && outline.length() > TurnWhiteboard.MAX_OUTLINE_CHARS) {
            outline = outline.substring(0, TurnWhiteboard.MAX_OUTLINE_CHARS);
        }
        return new TurnWhiteboard(upload.png(), scene, outline);
    }

    /** A turn's whiteboard, for the report image and for reopening the board in the room. */
    @Transactional(readOnly = true)
    public TurnWhiteboard whiteboard(Long id, Long turnId) {
        InterviewTurn turn = find(id).getTurns().stream()
                .filter(t -> t.getId().equals(turnId) && t.hasWhiteboard())
                .findFirst()
                .orElseThrow(() -> new NotFoundException("Whiteboard for turn", turnId));
        return (TurnWhiteboard) Hibernate.unproxy(turn.getWhiteboard());
    }

    private static String requireQuestion(TurnDecision decision) {
        String q = decision.nextQuestion();
        if (q == null || q.isBlank()) {
            throw new AiResponseException("The AI did not provide the follow-up question. Please resubmit your answer.");
        }
        return q.strip();
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }

    private static List<String> nullToEmpty(List<String> list) {
        return list == null ? List.of() : list;
    }

    /**
     * Interviews created before plans existed have turns but no plan: rebuild a plan from the main questions they
     * actually asked and link their turns to it, so question status and reattempts work for them too. Only touches
     * interviews whose plan is empty, so it is a no-op once everything has been backfilled.
     */
    @Transactional
    public void backfillLegacyPlans() {
        for (Interview interview : interviews.findAll()) {
            if (!interview.getPlan().isEmpty() || interview.getTurns().isEmpty()) {
                continue;
            }
            InterviewQuestion current = null;
            for (InterviewTurn turn : interview.getTurns()) {
                if (!turn.isFollowUp()) {
                    // No topic: legacy questions weren't labelled (and some predate the introduction question).
                    current = interview.plan(turn.getAskedBy(), null, turn.getQuestion());
                }
                turn.setPlannedQuestion(current);
            }
            log.info("Backfilled a {}-question plan for interview {}", interview.getPlan().size(), interview.getId());
        }
    }
}
