package com.mockinterviewer.topic;

import com.mockinterviewer.config.AiProperties;
import com.mockinterviewer.topic.TopicCatalog.Category;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Topic suggestions for the start-interview form. */
@RestController
@RequestMapping("/api/topics")
public class TopicController {

    /**
     * {@code maxTopics} is how many focus topics one round may have; {@code aliases} maps shorthand (as a
     * {@link TopicCatalog#key}) to its catalog topic, so the form can resolve "dsa" the way the server will.
     */
    public record TopicCatalogResponse(int maxTopics, int maxTopicChars, List<Category> categories,
            Map<String, String> aliases) {
    }

    private final AiProperties props;

    public TopicController(AiProperties props) {
        this.props = props;
    }

    @GetMapping
    public TopicCatalogResponse catalog() {
        return new TopicCatalogResponse(TopicCatalog.maxTopics(props.maxQuestions()), TopicCatalog.MAX_TOPIC_CHARS,
                TopicCatalog.CATEGORIES, TopicCatalog.ALIASES);
    }
}
