package com.mockinterviewer.interviewer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.mockinterviewer.company.Company;
import com.mockinterviewer.company.CompanyRepository;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "spring.datasource.url=jdbc:h2:mem:phototest;DB_CLOSE_DELAY=-1")
@AutoConfigureMockMvc
class InterviewerPhotoTest {

    private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3};
    private static final byte[] JPEG = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 4, 5, 6};

    @TempDir
    static Path uploads;

    @DynamicPropertySource
    static void uploadDir(DynamicPropertyRegistry registry) {
        registry.add("app.uploads.dir", uploads::toString);
    }

    @Autowired MockMvc mvc;
    @Autowired CompanyRepository companies;
    @Autowired InterviewerRepository interviewers;

    private Interviewer interviewer;

    @BeforeEach
    void setUp() {
        Company company = companies.save(new Company("Photo Co " + System.nanoTime(), "", "", "", null));
        interviewer = interviewers.save(new Interviewer("Pat", "Engineer", 5, "", "", null, company));
    }

    @Test
    void uploadServeReplaceAndRemove() throws Exception {
        String url = "/api/interviewers/" + interviewer.getId() + "/photo";

        String firstUrl = upload(url, PNG);
        assertThat(firstUrl).startsWith(url + "?v=");
        mvc.perform(get(url)).andExpect(status().isOk())
                .andExpect(content().contentType("image/png")).andExpect(content().bytes(PNG));

        String secondUrl = upload(url, JPEG);
        assertThat(secondUrl).isNotEqualTo(firstUrl);
        mvc.perform(get(url)).andExpect(content().contentType("image/jpeg"));
        try (var files = Files.list(uploads.resolve("interviewers"))) {
            assertThat(files.filter(f -> f.getFileName().toString().startsWith(interviewer.getId() + "-")))
                    .as("the replaced photo is deleted").hasSize(1);
        }

        mvc.perform(delete(url)).andExpect(status().isOk()).andExpect(jsonPath("$.photoUrl").isEmpty());
        mvc.perform(get(url)).andExpect(status().isNotFound());
    }

    @Test
    void nonImageIsRejected() throws Exception {
        mvc.perform(multipart("/api/interviewers/" + interviewer.getId() + "/photo")
                        .file(new MockMultipartFile("photo", "photo.png", "image/png", "<svg/>".getBytes())))
                .andExpect(status().isBadRequest());
    }

    private String upload(String url, byte[] data) throws Exception {
        String body = mvc.perform(multipart(url).file(new MockMultipartFile("photo", "p", "image/*", data)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.photoUrl");
    }
}
