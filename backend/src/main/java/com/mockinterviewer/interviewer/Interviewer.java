package com.mockinterviewer.interviewer;

import com.mockinterviewer.company.Company;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;
import java.time.Instant;

/** An AI interviewer persona on a company's interview panel. Interviews draw only from that company's interviewers. */
@Entity
public class Interviewer {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    /** Job title, e.g. "Staff Backend Engineer". */
    private String title;

    private int yearsOfExperience;

    /** Comma-separated areas, e.g. "distributed systems, Java, system design". */
    @Column(columnDefinition = "TEXT")
    private String expertise;

    /** Free-form persona context: background, interviewing style, temperament. */
    @Column(columnDefinition = "TEXT")
    private String background;

    /** Azure neural voice name, e.g. "en-US-AndrewNeural". Null means the UI picks a default. */
    private String voice;

    /** Uploaded photo's file name in {@link PhotoStorage}. Null means the UI shows a generated avatar. */
    private String photoFile;

    /** Required; the DB column stays nullable only so ddl-auto can add it to existing rows. */
    @ManyToOne(fetch = FetchType.LAZY)
    private Company company;

    private Instant createdAt = Instant.now();

    protected Interviewer() {
    }

    public Interviewer(String name, String title, int yearsOfExperience, String expertise, String background,
            String voice, Company company) {
        update(name, title, yearsOfExperience, expertise, background, voice, company);
    }

    public void update(String name, String title, int yearsOfExperience, String expertise, String background,
            String voice, Company company) {
        this.name = name;
        this.title = title;
        this.yearsOfExperience = yearsOfExperience;
        this.expertise = expertise;
        this.background = background;
        this.voice = voice;
        this.company = company;
    }

    public Long getId() { return id; }
    public String getName() { return name; }
    public String getTitle() { return title; }
    public int getYearsOfExperience() { return yearsOfExperience; }
    public String getExpertise() { return expertise; }
    public String getBackground() { return background; }
    public String getVoice() { return voice; }
    public String getPhotoFile() { return photoFile; }
    public void setPhotoFile(String photoFile) { this.photoFile = photoFile; }

    /** Where the browser loads the photo from; the file name in the query busts caches after a re-upload. */
    public String getPhotoUrl() {
        return photoFile == null ? null : "/api/interviewers/" + id + "/photo?v=" + photoFile;
    }
    public Company getCompany() { return company; }
    public Instant getCreatedAt() { return createdAt; }
}
