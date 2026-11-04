package com.mockinterviewer.interviewer;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public final class InterviewerDtos {

    private InterviewerDtos() {
    }

    public record InterviewerRequest(
            @NotBlank @Size(max = 200) String name,
            @Size(max = 200) String title,
            @Min(0) @Max(60) int yearsOfExperience,
            @Size(max = 2000) String expertise,
            @Size(max = 4000) String background,
            @Size(max = 100) String voice,
            @NotNull Long companyId) {
    }

    public record InterviewerResponse(
            Long id, String name, String title, int yearsOfExperience, String expertise, String background,
            String voice, String photoUrl, Long companyId, String companyName) {

        public static InterviewerResponse from(Interviewer i) {
            return new InterviewerResponse(i.getId(), i.getName(), i.getTitle(), i.getYearsOfExperience(),
                    i.getExpertise(), i.getBackground(), i.getVoice(), i.getPhotoUrl(),
                    i.getCompany() == null ? null : i.getCompany().getId(),
                    i.getCompany() == null ? null : i.getCompany().getName());
        }
    }
}
