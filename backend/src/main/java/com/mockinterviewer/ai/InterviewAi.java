package com.mockinterviewer.ai;

import com.mockinterviewer.ai.AiProvider.Content;
import com.mockinterviewer.ai.AiProvider.Effort;
import com.mockinterviewer.ai.AiOutputs.FinalEvaluation;
import com.mockinterviewer.ai.AiOutputs.InterviewPlan;
import com.mockinterviewer.ai.AiOutputs.PanelAssignment;
import com.mockinterviewer.ai.AiOutputs.PlannedQuestion;
import com.mockinterviewer.ai.AiOutputs.StudyGuide;
import com.mockinterviewer.ai.AiOutputs.TurnDecision;
import com.mockinterviewer.common.AiResponseException;
import com.mockinterviewer.config.AiProperties;
import com.mockinterviewer.interview.Interview;
import com.mockinterviewer.interview.InterviewQuestion;
import com.mockinterviewer.interview.InterviewTurn;
import com.mockinterviewer.interviewer.Interviewer;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.stereotype.Service;

/**
 * All AI calls for an interview, through whichever {@link AiProvider} is configured. Each call is a single stateless request: system prompt, then one user
 * message holding [resume, interview setup (cache breakpoint), transcript, task]. The transcript is rebuilt
 * from the database every time, so there is no conversation state to keep in sync with the API.
 */
@Service
public class InterviewAi {

    private final AiProvider provider;
    private final AiProperties props;

    public InterviewAi(AiProvider provider, AiProperties props) {
        this.provider = provider;
        this.props = props;
    }

    /**
     * One slot in the interview plan: who asks it and, when the round has focus topics, the topic it must cover
     * (null for the introduction and for slots the AI chooses the area of).
     */
    public record PlanSlot(Interviewer askedBy, String topic) {
    }

    /**
     * Chooses the interviewers from the company's {@code roster} using the full context (resume, role, job
     * description, round, company), and who asks each slot. {@code interview} is the draft being started, still
     * without a panel. The answer is advisory: {@code InterviewerAssigner} enforces sizes and ids.
     *
     * @param slotTopics the main slots' topics in order, empty when the round has no focus topics
     */
    public PanelAssignment assignPanel(Interview interview, List<Interviewer> roster, int panelSize,
            List<String> slotTopics) {
        return call(PanelAssignment.class, Effort.TURN, interview, InterviewPrompts.panelTask(roster,
                interview.getMode(), panelSize, interview.mainQuestions(), interview.hasIntroduction(), slotTopics));
    }

    /**
     * Writes every main question up front, one per slot; {@code slots} says who asks each and on what topic
     * (slot 1 is the introduction, when the interview has one). Returns exactly {@code slots.size()} questions or
     * throws.
     */
    public List<PlannedQuestion> planInterview(Interview interview, List<PlanSlot> slots) {
        InterviewPlan plan = call(InterviewPlan.class, Effort.FINAL, interview,
                InterviewPrompts.planTask(slots, interview.getMode(),
                        interview.hasIntroduction() ? randomIntroductionAngle() : null, interview.isCodingRound()));
        List<PlannedQuestion> questions = plan.questions() == null ? List.of() : plan.questions();
        if (questions.size() < slots.size()
                || questions.stream().limit(slots.size()).anyMatch(q -> q.question() == null || q.question().isBlank())) {
            throw new AiResponseException("The AI returned an incomplete interview plan. Please try again.");
        }
        return questions.subList(0, slots.size());
    }

    /** Scores the latest answer and decides whether to probe it with a follow-up or move to the next planned question. */
    public TurnDecision nextTurn(Interview interview, Interviewer followUpSpeaker, boolean followUpAllowed,
            boolean morePlanned) {
        return call(TurnDecision.class, Effort.TURN, interview,
                InterviewPrompts.turnTask(followUpSpeaker, followUpAllowed, morePlanned, interview.isCodingRound()));
    }

    public FinalEvaluation finalEvaluation(Interview interview) {
        return call(FinalEvaluation.class, Effort.FINAL, interview, InterviewPrompts.finalTask(interview));
    }

    /**
     * A model answer and reading list for one planned question of an ended interview. {@code outcome} is
     * "answered", "skipped" or "not reached".
     */
    public StudyGuide studyGuide(Interview interview, InterviewQuestion question, String outcome) {
        return studyGuideCall(interview, InterviewPrompts.studyGuideTask(
                question.getPosition(), question.getTopic(), question.getText(), outcome));
    }

    /**
     * The same for a follow-up: {@code number} is its 1-based index among the follow-ups to its planned question.
     * {@code outcome} is "answered" or "skipped".
     */
    public StudyGuide followUpStudyGuide(Interview interview, InterviewTurn followUp, int number, String outcome) {
        InterviewQuestion question = followUp.getPlannedQuestion();
        return studyGuideCall(interview, InterviewPrompts.followUpStudyGuideTask(
                question.getPosition(), question.getTopic(), number, followUp.getQuestion(), outcome));
    }

    private StudyGuide studyGuideCall(Interview interview, String task) {
        StudyGuide guide = call(StudyGuide.class, Effort.FINAL, interview, task);
        if (guide.modelAnswer() == null || guide.modelAnswer().isBlank()) {
            throw new AiResponseException("The AI returned no model answer. Please try again.");
        }
        return guide;
    }

    private <T> T call(Class<T> type, Effort effort, Interview interview, String task) {
        List<Content> content = new ArrayList<>();
        content.add(new AiProvider.Document("Candidate resume", interview.getResumeData(), interview.isPdfResume()));
        content.add(new AiProvider.Text(InterviewPrompts.setup(interview, interview.mainQuestions(),
                interview.maxFollowUps(props.maxFollowUps())), true));
        // Transcript text with the candidate's whiteboard images in place, then the task.
        List<InterviewPrompts.Part> parts = new ArrayList<>(InterviewPrompts.transcriptParts(interview.getTurns(),
                interview.hasIntroduction()));
        parts.add(new InterviewPrompts.Text("\n\n" + task));
        StringBuilder text = new StringBuilder();
        for (InterviewPrompts.Part part : parts) {
            switch (part) {
                case InterviewPrompts.Text(String t) -> text.append(t);
                case InterviewPrompts.Image(var board) -> {
                    content.add(new AiProvider.Text(text.toString()));
                    text.setLength(0);
                    content.add(new AiProvider.Image(board.getPng()));
                }
            }
        }
        content.add(new AiProvider.Text(text.toString()));
        return provider.structured(type, effort, InterviewPrompts.SYSTEM, content,
                type.getSimpleName() + (interview.getId() == null ? " for a new interview" : " for interview " + interview.getId()));
    }

    private static String randomIntroductionAngle() {
        List<String> angles = InterviewPrompts.INTRODUCTION_ANGLES;
        return angles.get(ThreadLocalRandom.current().nextInt(angles.size()));
    }

}
