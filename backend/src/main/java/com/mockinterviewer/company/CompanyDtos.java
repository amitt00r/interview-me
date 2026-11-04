package com.mockinterviewer.company;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class CompanyDtos {

    private CompanyDtos() {
    }

    public record CompanyRequest(
            @NotBlank @Size(max = 200) String name,
            @Size(max = 200) String industry,
            @Size(max = 4000) String description,
            @Size(max = 4000) String interviewFocus,
            @Size(max = 2000) String logoUrl) {
    }

    public record CompanyResponse(
            Long id, String name, String industry, String description, String interviewFocus, String logoUrl,
            long interviewerCount) {

        public static CompanyResponse from(Company c, long interviewerCount) {
            return new CompanyResponse(c.getId(), c.getName(), c.getIndustry(), c.getDescription(),
                    c.getInterviewFocus(), c.getLogoUrl(), interviewerCount);
        }
    }
}
