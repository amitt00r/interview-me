package com.mockinterviewer.ai.openai;

import static org.assertj.core.api.Assertions.assertThat;

import com.mockinterviewer.ai.AiOutputs.FinalEvaluation;
import com.mockinterviewer.ai.AiOutputs.InterviewPlan;
import com.mockinterviewer.ai.AiOutputs.PanelAssignment;
import com.mockinterviewer.ai.AiOutputs.StudyGuide;
import com.mockinterviewer.ai.AiOutputs.TurnDecision;
import com.openai.models.chat.completions.ChatCompletionCreateParams;
import java.util.List;
import org.junit.jupiter.api.Test;

class OpenAiProviderTest {

    /** OpenAI's strict structured outputs reject some schemas; the SDK checks them locally when building params. */
    @Test
    void everyStructuredOutputRecordIsAValidOpenAiSchema() {
        for (Class<?> type : List.of(InterviewPlan.class, PanelAssignment.class, TurnDecision.class, StudyGuide.class,
                FinalEvaluation.class)) {
            assertThat(ChatCompletionCreateParams.builder()
                    .model("m")
                    .addUserMessage("x")
                    .responseFormat(type)
                    .build())
                    .as(type.getSimpleName())
                    .isNotNull();
        }
    }
}
