package com.mockinterviewer.interview;

import com.mockinterviewer.interviewer.Interviewer;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Embedded;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToOne;
import java.time.Instant;

/** One question (main or follow-up) and the candidate's answer to it, with the AI's per-answer score. */
@Entity
public class InterviewTurn {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    private Interview interview;

    @ManyToOne(optional = false)
    private Interviewer askedBy;

    /** The planned question this turn asks (main) or probes (follow-up). Null only on pre-planning rows. */
    @ManyToOne(fetch = FetchType.LAZY)
    private InterviewQuestion plannedQuestion;

    /** 1-based position within the interview. */
    private int sequence;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String question;

    private boolean followUp;

    @Column(columnDefinition = "TEXT")
    private String answer;

    /**
     * The interview ended while this question was waiting. It stays out of reports and evaluation, but stays in
     * the reattempt script so a reattempt asks it. Nullable so ddl-auto can add it to existing rows.
     */
    private Boolean dropped;

    /** The candidate chose to skip this question. Nullable so ddl-auto can add it to existing rows. */
    private Boolean skipped;

    /**
     * How long the candidate took, from the question appearing in the room to submitting or skipping. Measured by
     * the browser (it only counts while the room is open); null on rows recorded before timing existed.
     */
    private Integer responseSeconds;

    /** 0-10, set once the answer has been evaluated. */
    private Integer score;

    @Column(columnDefinition = "TEXT")
    private String feedback;

    private Instant askedAt = Instant.now();

    private Instant answeredAt;

    /**
     * The interviewer asked the candidate to sketch this one on the whiteboard (the room opens it). Nullable so
     * ddl-auto can add it to existing rows.
     */
    private Boolean whiteboardRequested;

    /** The whiteboard submitted with the answer, if the candidate drew anything. Lazy: it holds the image. */
    @OneToOne(fetch = FetchType.LAZY, cascade = CascadeType.ALL, orphanRemoval = true)
    private TurnWhiteboard whiteboard;

    /** "Ask AI" model answer and reading list for a follow-up; null until asked for (main questions keep theirs on the plan). */
    @Embedded
    private StudyGuideNotes studyGuide;

    protected InterviewTurn() {
    }

    InterviewTurn(Interview interview, InterviewQuestion plannedQuestion, Interviewer askedBy, int sequence,
            String question, boolean followUp, boolean whiteboardRequested) {
        this.interview = interview;
        this.plannedQuestion = plannedQuestion;
        this.askedBy = askedBy;
        this.sequence = sequence;
        this.question = question;
        this.followUp = followUp;
        this.whiteboardRequested = whiteboardRequested;
    }

    /** {@code whiteboard} is null when the candidate didn't draw. */
    public void recordAnswer(String answer, Integer responseSeconds, TurnWhiteboard whiteboard) {
        this.answer = answer;
        this.answeredAt = Instant.now();
        this.responseSeconds = responseSeconds;
        this.whiteboard = whiteboard;
    }

    public void recordEvaluation(int score, String feedback) {
        this.score = score;
        this.feedback = feedback;
    }

    /** Skipping scores 0 without asking the AI. */
    public void recordSkip(Integer responseSeconds) {
        this.skipped = true;
        this.responseSeconds = responseSeconds;
        this.answeredAt = Instant.now();
        this.score = 0;
        this.feedback = "Skipped.";
    }

    public boolean isAnswered() {
        return answer != null;
    }

    public boolean isSkipped() {
        return Boolean.TRUE.equals(skipped);
    }

    public void drop() {
        this.dropped = true;
    }

    public boolean isDropped() {
        return Boolean.TRUE.equals(dropped);
    }

    /** Answered or skipped: no longer waiting on the candidate. */
    public boolean isResolved() {
        return isAnswered() || isSkipped();
    }

    void recordStudyGuide(StudyGuideNotes notes) {
        this.studyGuide = notes;
    }

    /** The stored guide, if the candidate has asked for one. */
    public StudyGuideNotes getStudyGuide() {
        return StudyGuideNotes.present(studyGuide) ? studyGuide : null;
    }

    public Long getId() { return id; }
    public Interview getInterview() { return interview; }
    public Interviewer getAskedBy() { return askedBy; }
    public InterviewQuestion getPlannedQuestion() { return plannedQuestion; }
    /** Only for linking pre-planning rows to their backfilled plan. */
    void setPlannedQuestion(InterviewQuestion plannedQuestion) { this.plannedQuestion = plannedQuestion; }
    public int getSequence() { return sequence; }
    public String getQuestion() { return question; }
    public boolean isFollowUp() { return followUp; }
    public boolean isWhiteboardRequested() { return Boolean.TRUE.equals(whiteboardRequested); }
    /** May be an uninitialised proxy; null-checking it doesn't load the image. */
    public TurnWhiteboard getWhiteboard() { return whiteboard; }
    public boolean hasWhiteboard() { return whiteboard != null; }
    public String getAnswer() { return answer; }
    public Integer getResponseSeconds() { return responseSeconds; }
    public Integer getScore() { return score; }
    public String getFeedback() { return feedback; }
    public Instant getAskedAt() { return askedAt; }
    public Instant getAnsweredAt() { return answeredAt; }
}
