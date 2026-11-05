package com.mockinterviewer.interview;

import com.mockinterviewer.interviewer.Interviewer;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;

public final class InterviewDtos {

    private InterviewDtos() {
    }

    private static Long originalIdOf(Interview i) {
        return i.isReattempt() ? i.getRetakeOf().getId() : null;
    }

    /**
     * {@code responseSeconds} is the browser's measure of how long the candidate took; optional. {@code answer} may
     * be empty when a {@code whiteboard} or {@code code} is sent.
     */
    public record AnswerRequest(@Size(max = 20000) String answer,
            @Min(0) @Max(86_400) Integer responseSeconds, @Valid WhiteboardRequest whiteboard,
            @Valid CodeRequest code) {
    }

    /** The code editor's contents at submit time. */
    public record CodeRequest(@NotNull CodeLanguage language,
            @NotBlank @Size(max = TurnCode.MAX_SOURCE_CHARS) String source) {
    }

    /** Code submitted with an answer. */
    public record CodeResponse(CodeLanguage language, String source) {

        static CodeResponse from(InterviewTurn t) {
            TurnCode code = t == null ? null : t.getCode();
            return code == null ? null : new CodeResponse(code.getLanguage(), code.getSource());
        }
    }

    /**
     * The whiteboard at submit time: {@code png} is base64 (Spring decodes it into bytes), {@code scene} the
     * Excalidraw scene JSON, {@code outline} the browser's text summary of its labels and arrows.
     */
    public record WhiteboardRequest(@NotNull byte[] png, String scene, String outline) {
    }

    public record SkipRequest(@Min(0) @Max(86_400) Integer responseSeconds) {
    }

    public record InterviewerRef(Long id, String name, String title, String voice, String photoUrl) {

        static InterviewerRef from(Interviewer i) {
            return new InterviewerRef(i.getId(), i.getName(), i.getTitle(), i.getVoice(), i.getPhotoUrl());
        }
    }

    public record TurnResponse(
            Long id, int sequence, InterviewerRef askedBy, String question, boolean followUp, String answer,
            boolean skipped, Integer score, String feedback, Instant askedAt, Instant answeredAt,
            Integer responseSeconds, StudyGuideResponse studyGuide, boolean whiteboardRequested,
            String whiteboardUrl, CodeLanguage codeRequested, CodeResponse code) {

        static TurnResponse from(InterviewTurn t) {
            return new TurnResponse(t.getId(), t.getSequence(), InterviewerRef.from(t.getAskedBy()), t.getQuestion(),
                    t.isFollowUp(), t.getAnswer(), t.isSkipped(), t.getScore(), t.getFeedback(), t.getAskedAt(),
                    t.getAnsweredAt(), t.getResponseSeconds(), StudyGuideResponse.from(t.getStudyGuide()),
                    t.isWhiteboardRequested(), whiteboardUrlOf(t), t.getCodeRequested(), CodeResponse.from(t));
        }
    }

    /** Where the browser fetches the PNG of a turn's whiteboard; null when the candidate didn't draw. */
    static String whiteboardUrlOf(InterviewTurn t) {
        return t == null || !t.hasWhiteboard() ? null
                : "/api/interviews/" + t.getInterview().getId() + "/turns/" + t.getId() + "/whiteboard.png";
    }

    public record StudyTopicDto(String topic, String reason) {
    }

    /** "Ask AI" coaching for a main question or follow-up: a model answer and what to read up on. */
    public record StudyGuideResponse(String modelAnswer, List<StudyTopicDto> studyTopics) {

        static StudyGuideResponse from(StudyGuideNotes notes) {
            return notes == null ? null : new StudyGuideResponse(notes.getModelAnswer(), notes.getStudyTopics().stream()
                    .map(t -> new StudyTopicDto(t[0], t[1])).toList());
        }
    }

    /** Where a planned question stands in this attempt. */
    public enum QuestionStatus { ANSWERED, SKIPPED, CURRENT, NOT_ATTEMPTED }

    /** A planned question with this attempt's outcome: its main answer and any follow-ups. */
    public record QuestionResult(
            Long id, int position, String topic, String question, InterviewerRef askedBy, QuestionStatus status,
            String answer, Integer score, String feedback, Integer responseSeconds, List<TurnResponse> followUps,
            StudyGuideResponse studyGuide, String whiteboardUrl, CodeLanguage codeLanguage, CodeResponse code) {

        static List<QuestionResult> from(Interview i) {
            return i.getPlan().stream().map(q -> {
                List<InterviewTurn> turns = i.getTurns().stream()
                        .filter(t -> t.getPlannedQuestion() != null && q.getId().equals(t.getPlannedQuestion().getId()))
                        .toList();
                InterviewTurn main = turns.stream().filter(t -> !t.isFollowUp()).findFirst().orElse(null);
                List<TurnResponse> followUps = turns.stream()
                        .filter(t -> t.isFollowUp() && (t.isResolved() || isPending(i, t)))
                        .map(TurnResponse::from).toList();
                return new QuestionResult(q.getId(), q.getPosition(), q.getTopic(), q.getText(),
                        InterviewerRef.from(q.getAskedBy()), status(i, main),
                        main == null ? null : main.getAnswer(), main == null ? null : main.getScore(),
                        main == null || main.isSkipped() ? null : main.getFeedback(),
                        main == null ? null : main.getResponseSeconds(), followUps, StudyGuideResponse.from(q.getStudyGuide()),
                        whiteboardUrlOf(main), q.getCodeLanguage(), CodeResponse.from(main));
            }).toList();
        }

        private static QuestionStatus status(Interview i, InterviewTurn main) {
            if (main == null || main.isDropped()) {
                return QuestionStatus.NOT_ATTEMPTED;
            }
            if (main.isAnswered()) {
                return QuestionStatus.ANSWERED;
            }
            if (main.isSkipped()) {
                return QuestionStatus.SKIPPED;
            }
            return isPending(i, main) ? QuestionStatus.CURRENT : QuestionStatus.NOT_ATTEMPTED;
        }

        private static boolean isPending(Interview i, InterviewTurn t) {
            return i.pendingTurn().map(p -> p == t).orElse(false);
        }
    }

    /**
     * How the candidate did on one focus topic in this attempt. {@code minScore}, {@code maxScore} and
     * {@code lastScore} (0-10) cover every resolved turn on the topic's questions, follow-ups included and skips
     * counting as 0, so depth under probing shows; "last" is the most recently resolved one. All null until
     * something on the topic is answered or skipped.
     */
    public record TopicResult(String topic, int questions, int answered, int skipped,
                              Integer minScore, Integer maxScore, Integer lastScore) {

        static List<TopicResult> from(Interview i) {
            return i.getFocusTopics().stream().map(topic -> {
                List<InterviewQuestion> questions = i.getPlan().stream()
                        .filter(q -> topic.equals(q.getTopic())).toList();
                List<InterviewTurn> mains = i.getTurns().stream()
                        .filter(t -> !t.isFollowUp() && t.getPlannedQuestion() != null
                                && topic.equals(t.getPlannedQuestion().getTopic()))
                        .toList();
                // Turns are ordered by sequence, so the last score is the most recent one on the topic.
                List<Integer> scores = i.getTurns().stream()
                        .filter(t -> t.isResolved() && t.getScore() != null && t.getPlannedQuestion() != null
                                && topic.equals(t.getPlannedQuestion().getTopic()))
                        .map(InterviewTurn::getScore).toList();
                return new TopicResult(topic, questions.size(),
                        (int) mains.stream().filter(InterviewTurn::isAnswered).count(),
                        (int) mains.stream().filter(InterviewTurn::isSkipped).count(),
                        scores.stream().min(Integer::compare).orElse(null),
                        scores.stream().max(Integer::compare).orElse(null),
                        scores.isEmpty() ? null : scores.getLast());
            }).toList();
        }
    }

    public record InterviewSummary(
            Long id, String candidateName, String targetRole, Long companyId, String companyName, InterviewMode mode,
            InterviewStatus status, Integer overallScore, List<InterviewerRef> interviewers, Instant startedAt,
            Instant completedAt, Long retakeOfId, int attempt, String companyLogoUrl, int attemptedQuestions,
            int skippedQuestions, int plannedQuestions, int answeringSeconds, Long durationSeconds,
            boolean reattemptable, String roundName, List<String> focusTopics) {

        static InterviewSummary from(Interview i) {
            return new InterviewSummary(i.getId(), i.getCandidateName(), i.getTargetRole(), i.getCompany().getId(),
                    i.getCompany().getName(), i.getMode(), i.getStatus(), i.getOverallScore(),
                    i.getInterviewers().stream().map(InterviewerRef::from).toList(), i.getStartedAt(),
                    i.getCompletedAt(), originalIdOf(i), i.getAttempt(), i.getCompany().getLogoUrl(),
                    i.attemptedQuestions(), i.skippedQuestions(), i.getPlannedQuestions(), i.answeringSeconds(),
                    i.durationSeconds(), i.canBeReattempted(), i.getRoundName(), List.copyOf(i.getFocusTopics()));
        }
    }

    /** One attempt in an interview's history, for comparing scores across reattempts. */
    public record AttemptSummary(Long id, int attempt, InterviewStatus status, Integer overallScore,
            Instant startedAt, Instant completedAt) {

        static AttemptSummary from(Interview i) {
            return new AttemptSummary(i.getId(), i.getAttempt(), i.getStatus(), i.getOverallScore(),
                    i.getStartedAt(), i.getCompletedAt());
        }
    }

    public record InterviewDetail(
            Long id, String candidateName, String targetRole, Long companyId, String companyName, InterviewMode mode,
            InterviewStatus status, String jobDescription, List<InterviewerRef> interviewers,
            List<TurnResponse> turns, Long pendingTurnId, String resumeFileName, Integer overallScore, String summary, List<String> strengths,
            List<String> improvements, Instant startedAt, Instant completedAt, Long retakeOfId, int attempt,
            int answeringSeconds, Long durationSeconds, int attemptedQuestions, int skippedQuestions,
            int plannedQuestions, boolean reattemptable, List<QuestionResult> questions, String roundName,
            String roundDescription, List<String> focusTopics, List<TopicResult> topicResults,
            int answerPauseSeconds) {

        static InterviewDetail from(Interview i) {
            return new InterviewDetail(i.getId(), i.getCandidateName(), i.getTargetRole(), i.getCompany().getId(),
                    i.getCompany().getName(), i.getMode(), i.getStatus(), i.getJobDescription(),
                    i.getInterviewers().stream().map(InterviewerRef::from).toList(),
                    i.getTurns().stream().map(TurnResponse::from).toList(),
                    i.pendingTurn().map(InterviewTurn::getId).orElse(null), i.getResumeFileName(),
                    i.getOverallScore(), i.getSummary(), lines(i.getStrengths()), lines(i.getImprovements()),
                    i.getStartedAt(), i.getCompletedAt(), originalIdOf(i), i.getAttempt(), i.answeringSeconds(),
                    i.durationSeconds(), i.attemptedQuestions(), i.skippedQuestions(), i.getPlannedQuestions(),
                    i.canBeReattempted(), QuestionResult.from(i), i.getRoundName(), i.getRoundDescription(),
                    List.copyOf(i.getFocusTopics()), TopicResult.from(i), i.getAnswerPauseSeconds());
        }

        private static List<String> lines(String s) {
            return s == null || s.isBlank() ? List.of() : Arrays.asList(s.split("\n"));
        }
    }
}
