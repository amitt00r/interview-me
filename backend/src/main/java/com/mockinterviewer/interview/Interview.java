package com.mockinterviewer.interview;

import com.mockinterviewer.company.Company;
import com.mockinterviewer.interviewer.Interviewer;
import jakarta.persistence.Basic;
import jakarta.persistence.CascadeType;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.OrderColumn;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** One mock interview session. Completed and abandoned sessions make up the "past interviews" history. */
@Entity
public class Interview {

    public static final int DEFAULT_ANSWER_PAUSE_SECONDS = 10;
    public static final int MIN_ANSWER_PAUSE_SECONDS = 3;
    public static final int MAX_ANSWER_PAUSE_SECONDS = 60;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String candidateName;

    private String targetRole;

    /** Optional job posting the candidate is preparing for; tailors questions and evaluation. */
    @Column(columnDefinition = "TEXT")
    private String jobDescription;

    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    private Company company;

    /** Optional name of the round being practised, e.g. "Round 2 - Backend deep dive". */
    @Column(length = 100)
    private String roundName;

    /** Optional brief for the round: what it covers and how it is run. */
    @Column(columnDefinition = "TEXT")
    private String roundDescription;

    /**
     * Optional topics the round is restricted to, in priority order (catalog names where they match). When set,
     * every main question after the introduction is about one of them; see {@code InterviewService.slotTopics}.
     */
    @ElementCollection
    @CollectionTable(name = "interview_focus_topic", joinColumns = @JoinColumn(name = "interview_id"))
    @OrderColumn(name = "position")
    @Column(name = "topic", nullable = false, length = 60)
    private List<String> focusTopics = new ArrayList<>();

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private InterviewMode mode;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private InterviewStatus status = InterviewStatus.IN_PROGRESS;

    /** Assigned interviewers; index order is the panel's speaking rotation for main questions. */
    @ManyToMany
    @JoinTable(name = "interview_interviewer")
    @OrderColumn(name = "position")
    private List<Interviewer> interviewers = new ArrayList<>();

    @OneToMany(mappedBy = "interview", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("sequence")
    private List<InterviewTurn> turns = new ArrayList<>();

    /** The main questions, written up front at start; reattempts copy it. */
    @OneToMany(mappedBy = "interview", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("position")
    private List<InterviewQuestion> plan = new ArrayList<>();

    /**
     * For a reattempt, the original interview whose plan it copies; null for an original. Always the original,
     * never another reattempt.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    private Interview retakeOf;

    /**
     * Main questions this interview was set up to ask (introduction included; follow-ups never count). Fixed at
     * creation so it doesn't shift if {@code app.ai.max-questions} changes later. Null only on rows that predate it.
     */
    private Integer plannedQuestions;

    /**
     * Hands-free answering: seconds of silence before the room submits what the candidate said. Short pauses train
     * continuous speaking. Nullable so ddl-auto can add it; null means {@link #DEFAULT_ANSWER_PAUSE_SECONDS}.
     */
    private Integer answerPauseSeconds;

    /** 1 for an original, 2+ for reattempts. Null on rows created before reattempts existed (treated as 1). */
    private Integer attempt;

    private String resumeFileName;

    private String resumeContentType;

    @Basic(fetch = FetchType.LAZY)
    @JdbcTypeCode(SqlTypes.VARBINARY)
    @Column(length = 10 * 1024 * 1024)
    private byte[] resumeData;

    /** 0-100, set when the interview is completed. */
    private Integer overallScore;

    @Column(columnDefinition = "TEXT")
    private String summary;

    /** Newline-separated. */
    @Column(columnDefinition = "TEXT")
    private String strengths;

    /** Newline-separated. */
    @Column(columnDefinition = "TEXT")
    private String improvements;

    private Instant startedAt = Instant.now();

    private Instant completedAt;

    protected Interview() {
    }

    public Interview(String candidateName, String targetRole, String jobDescription, Company company,
            InterviewMode mode, List<Interviewer> interviewers, String resumeFileName, String resumeContentType,
            byte[] resumeData) {
        this.candidateName = candidateName;
        this.targetRole = targetRole;
        this.jobDescription = jobDescription;
        this.company = company;
        this.mode = mode;
        this.interviewers = new ArrayList<>(interviewers);
        this.resumeFileName = resumeFileName;
        this.resumeContentType = resumeContentType;
        this.resumeData = resumeData;
    }

    /** Seats the panel chosen for a new interview (lead first); before the plan is written. */
    public void assignPanel(List<Interviewer> panel) {
        this.interviewers = new ArrayList<>(panel);
    }

    /**
     * A new attempt at {@code original}: same candidate, company, panel, resume and plan, no turns yet. Uses
     * getters because {@code original} may be a lazy proxy (when reached through another attempt's
     * {@code retakeOf}).
     */
    public static Interview reattempt(Interview original, int attempt) {
        Interview copy = new Interview(original.getCandidateName(), original.getTargetRole(),
                original.getJobDescription(), original.getCompany(), original.getMode(), original.getInterviewers(),
                original.getResumeFileName(), original.getResumeContentType(), original.getResumeData());
        copy.defineRound(original.getRoundName(), original.getRoundDescription(), original.getFocusTopics());
        copy.retakeOf = original;
        copy.attempt = attempt;
        copy.answerPauseSeconds = original.getAnswerPauseSeconds();
        original.getPlan().forEach(q -> copy.plan(q.getAskedBy(), q.getTopic(), q.getText(),
                q.isWhiteboard(), q.getCodeLanguage()));
        return copy;
    }

    /** Sets the round being practised; all parts optional. */
    public void defineRound(String name, String description, List<String> topics) {
        this.roundName = name;
        this.roundDescription = description;
        this.focusTopics = new ArrayList<>(topics == null ? List.of() : topics);
    }

    public boolean hasFocusTopics() {
        return !focusTopics.isEmpty();
    }

    /**
     * Appends a question to the plan. The planned count follows the plan but never shrinks, so legacy rows keep
     * the count they were set up with when their partial plan is backfilled.
     */
    public InterviewQuestion plan(Interviewer askedBy, String topic, String text) {
        return plan(askedBy, topic, text, false);
    }

    /** As above; {@code whiteboard} marks a question the candidate should sketch on the whiteboard. */
    public InterviewQuestion plan(Interviewer askedBy, String topic, String text, boolean whiteboard) {
        return plan(askedBy, topic, text, whiteboard, null);
    }

    /** As above; {@code code} marks a question answered in the code editor, in that language (null: not). */
    public InterviewQuestion plan(Interviewer askedBy, String topic, String text, boolean whiteboard,
            CodeLanguage code) {
        InterviewQuestion q = new InterviewQuestion(this, plan.size() + 1, askedBy, topic, text, whiteboard, code);
        plan.add(q);
        plannedQuestions = plannedQuestions == null ? plan.size() : Math.max(plannedQuestions, plan.size());
        return q;
    }

    /** Asks a planned question (a main turn). */
    public InterviewTurn ask(InterviewQuestion question) {
        return addTurn(question, question.getAskedBy(), question.getText(), false, question.isWhiteboard(),
                question.getCodeLanguage());
    }

    /** Asks a follow-up on the planned question currently being discussed. */
    public InterviewTurn askFollowUp(Interviewer askedBy, String text) {
        return askFollowUp(askedBy, text, false);
    }

    /** As above; {@code whiteboard} asks the candidate to draw (or extend their drawing) on the whiteboard. */
    public InterviewTurn askFollowUp(Interviewer askedBy, String text, boolean whiteboard) {
        return askFollowUp(askedBy, text, whiteboard, null);
    }

    /** As above; {@code code} asks the candidate to write (or change) code in that language (null: not). */
    public InterviewTurn askFollowUp(Interviewer askedBy, String text, boolean whiteboard, CodeLanguage code) {
        return addTurn(currentQuestion().orElse(null), askedBy, text, true, whiteboard, code);
    }

    /** The planned question being discussed: the one the latest turn belongs to. */
    public Optional<InterviewQuestion> currentQuestion() {
        return turns.isEmpty() ? Optional.empty() : Optional.ofNullable(turns.getLast().getPlannedQuestion());
    }

    /** The next planned question after the current one, if any. */
    public Optional<InterviewQuestion> nextPlannedQuestion() {
        int next = currentQuestion().map(InterviewQuestion::getPosition).orElse(0);
        return next < plan.size() ? Optional.of(plan.get(next)) : Optional.empty();
    }

    public boolean isReattempt() {
        return retakeOf != null;
    }

    /** Ended (completed or abandoned) with a plan to replay; any reattempt's original qualifies. */
    public boolean canBeReattempted() {
        return isReattempt() || (status != InterviewStatus.IN_PROGRESS && !plan.isEmpty());
    }

    private InterviewTurn addTurn(InterviewQuestion question, Interviewer askedBy, String text, boolean followUp,
            boolean whiteboard, CodeLanguage code) {
        InterviewTurn turn = new InterviewTurn(this, question, askedBy, turns.size() + 1, text, followUp, whiteboard,
                code);
        turns.add(turn);
        return turn;
    }

    /** The question currently waiting for the candidate's answer, if any. */
    public Optional<InterviewTurn> pendingTurn() {
        if (turns.isEmpty()) {
            return Optional.empty();
        }
        InterviewTurn last = turns.getLast();
        return last.isResolved() || last.isDropped() ? Optional.empty() : Optional.of(last);
    }

    /** Ending the interview: the waiting turn is kept (as dropped) but never answered or scored. */
    public void dropPendingTurn() {
        pendingTurn().ifPresent(InterviewTurn::drop);
    }

    /** Main questions the candidate actually answered; follow-ups and skips don't count. */
    public int attemptedQuestions() {
        return (int) turns.stream().filter(t -> !t.isFollowUp() && t.isAnswered()).count();
    }

    public int skippedQuestions() {
        return (int) turns.stream().filter(t -> !t.isFollowUp() && t.isSkipped()).count();
    }

    /** Follow-ups asked since the most recent main question. */
    public int followUpsOnCurrentQuestion() {
        int count = 0;
        for (int i = turns.size() - 1; i >= 0 && turns.get(i).isFollowUp(); i--) {
            count++;
        }
        return count;
    }

    /** Total time spent answering and skipping, from the per-question timings that were recorded. */
    public int answeringSeconds() {
        return turns.stream().map(InterviewTurn::getResponseSeconds).filter(Objects::nonNull)
                .mapToInt(Integer::intValue).sum();
    }

    /** Wall-clock length of the session, start to finish; null while it is still in progress. */
    public Long durationSeconds() {
        return completedAt == null ? null : Duration.between(startedAt, completedAt).toSeconds();
    }

    public boolean hasAnsweredTurns() {
        return turns.stream().anyMatch(InterviewTurn::isAnswered);
    }

    public void complete(int overallScore, String summary, List<String> strengths, List<String> improvements) {
        this.status = InterviewStatus.COMPLETED;
        this.overallScore = overallScore;
        this.summary = summary;
        this.strengths = String.join("\n", strengths);
        this.improvements = String.join("\n", improvements);
        this.completedAt = Instant.now();
    }

    public void abandon() {
        this.status = InterviewStatus.ABANDONED;
        this.completedAt = Instant.now();
    }

    public boolean isPdfResume() {
        return "application/pdf".equals(resumeContentType);
    }

    public Long getId() { return id; }
    public String getCandidateName() { return candidateName; }
    public String getTargetRole() { return targetRole; }
    public String getJobDescription() { return jobDescription; }
    public Company getCompany() { return company; }
    public String getRoundName() { return roundName; }
    public String getRoundDescription() { return roundDescription; }
    public int getAnswerPauseSeconds() {
        return answerPauseSeconds == null ? DEFAULT_ANSWER_PAUSE_SECONDS : answerPauseSeconds;
    }
    public void setAnswerPauseSeconds(Integer seconds) { this.answerPauseSeconds = seconds; }
    public List<String> getFocusTopics() { return focusTopics; }
    public InterviewMode getMode() { return mode; }
    public InterviewStatus getStatus() { return status; }
    public List<Interviewer> getInterviewers() { return interviewers; }
    public List<InterviewTurn> getTurns() { return turns; }
    public List<InterviewQuestion> getPlan() { return plan; }
    public String getResumeFileName() { return resumeFileName; }
    public String getResumeContentType() { return resumeContentType; }
    public byte[] getResumeData() { return resumeData; }
    public Integer getOverallScore() { return overallScore; }
    public String getSummary() { return summary; }
    public String getStrengths() { return strengths; }
    public String getImprovements() { return improvements; }
    public Instant getStartedAt() { return startedAt; }
    public Instant getCompletedAt() { return completedAt; }
    public Interview getRetakeOf() { return retakeOf; }
    public int getAttempt() { return attempt == null ? 1 : attempt; }
    /**
     * The plan's size; legacy rows keep the count they were set up with, which can exceed their (backfilled)
     * plan because unasked questions were never written down then.
     */
    public int getPlannedQuestions() {
        return plannedQuestions != null ? Math.max(plannedQuestions, plan.size()) : plan.size();
    }
}
