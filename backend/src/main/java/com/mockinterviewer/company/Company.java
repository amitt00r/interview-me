package com.mockinterviewer.company;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import java.time.Instant;

@Entity
public class Company {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String name;

    private String industry;

    @Column(columnDefinition = "TEXT")
    private String description;

    /** What this company's interviews emphasise: values, bar, typical rounds. Fed to the AI. */
    @Column(columnDefinition = "TEXT")
    private String interviewFocus;

    /** Optional logo image URL. Null means the UI shows a monogram. */
    private String logoUrl;

    private Instant createdAt = Instant.now();

    protected Company() {
    }

    public Company(String name, String industry, String description, String interviewFocus, String logoUrl) {
        update(name, industry, description, interviewFocus, logoUrl);
    }

    public void update(String name, String industry, String description, String interviewFocus, String logoUrl) {
        this.name = name;
        this.industry = industry;
        this.description = description;
        this.interviewFocus = interviewFocus;
        this.logoUrl = logoUrl;
    }

    public Long getId() { return id; }
    public String getName() { return name; }
    public String getIndustry() { return industry; }
    public String getDescription() { return description; }
    public String getInterviewFocus() { return interviewFocus; }
    public String getLogoUrl() { return logoUrl; }
    public Instant getCreatedAt() { return createdAt; }
}
