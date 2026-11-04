package com.mockinterviewer.interview;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/** On startup, gives pre-planning interviews a plan ({@link InterviewService#backfillLegacyPlans()}). */
@Component
class LegacyPlanBackfill implements ApplicationRunner {

    private final InterviewService interviews;

    LegacyPlanBackfill(InterviewService interviews) {
        this.interviews = interviews;
    }

    @Override
    public void run(ApplicationArguments args) {
        interviews.backfillLegacyPlans();
    }
}
