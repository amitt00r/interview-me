package com.mockinterviewer.topic;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The master list of interview topics offered as suggestions when setting up a round. It only suggests: candidates
 * can type any topic. Its other job is keeping names consistent, so "spring boot", "SpringBoot" and "Spring Boot"
 * all become the same topic and per-topic results line up across interviews ({@link #canonical}).
 */
public final class TopicCatalog {

    /** Most focus topics a round can have; also capped by the number of main questions. */
    public static final int MAX_TOPICS = 8;

    public static final int MAX_TOPIC_CHARS = 60;

    public record Category(String name, List<String> topics) {
    }

    public static final List<Category> CATEGORIES = List.of(
            new Category("Data Structures & Algorithms", List.of(
                    "Data Structures & Algorithms", "Arrays & Strings", "Hashing", "Linked Lists",
                    "Stacks & Queues", "Trees & BSTs", "Heaps & Priority Queues", "Graphs", "Tries",
                    "Sorting & Searching", "Binary Search", "Two Pointers & Sliding Window",
                    "Recursion & Backtracking", "Dynamic Programming", "Greedy Algorithms", "Bit Manipulation",
                    "Complexity Analysis")),
            new Category("Java", List.of(
                    "Java Core", "OOP Principles", "Collections Framework", "Generics", "Exception Handling",
                    "Java Streams & Lambdas", "Concurrency & Multithreading", "Virtual Threads",
                    "JVM Internals & Memory Model", "Garbage Collection & Tuning", "Modern Java (17-21)",
                    "Java Performance")),
            new Category("Spring", List.of(
                    "Spring Core & Dependency Injection", "Spring Boot", "Spring MVC & REST APIs",
                    "Spring Data JPA & Hibernate", "Spring Transactions", "Spring Security", "Spring Cloud",
                    "Spring WebFlux & Reactive", "Spring AOP", "Testing Spring Applications")),
            new Category("System Design", List.of(
                    "High-Level System Design", "Low-Level Design", "Design Patterns", "SOLID & Clean Architecture",
                    "Microservices Architecture", "Distributed Systems", "Scalability & Performance", "Caching",
                    "API Design", "Event-Driven Architecture", "Consistency & CAP", "Resilience & Fault Tolerance",
                    "Rate Limiting & Load Balancing")),
            new Category("Messaging & Streaming", List.of(
                    "Messaging & Queues", "Apache Kafka", "RabbitMQ", "JMS & ActiveMQ", "AWS SQS & SNS",
                    "Stream Processing", "Delivery Guarantees & Idempotency", "Event Sourcing & CQRS")),
            new Category("Databases", List.of(
                    "SQL & Query Optimisation", "Database Design & Normalisation", "Indexing",
                    "Transactions & Isolation Levels", "PostgreSQL", "MySQL", "NoSQL Databases", "MongoDB",
                    "Redis", "Cassandra", "Elasticsearch", "Sharding & Replication")),
            new Category("Cloud & DevOps", List.of(
                    "AWS", "Azure", "Google Cloud", "Docker", "Kubernetes", "CI/CD", "Terraform & IaC",
                    "Observability (Logs, Metrics, Tracing)", "Linux & Shell", "Git")),
            new Category("CS Fundamentals", List.of(
                    "Operating Systems", "Computer Networks", "HTTP & Web Fundamentals", "DBMS Concepts",
                    "Compilers & Runtimes")),
            new Category("Testing & Quality", List.of(
                    "Unit Testing (JUnit & Mockito)", "Integration Testing", "Test-Driven Development",
                    "Clean Code & Refactoring", "Code Review")),
            new Category("Security", List.of(
                    "Application Security (OWASP)", "Authentication & Authorisation", "OAuth2 & JWT",
                    "Cryptography Basics")),
            new Category("Frontend", List.of(
                    "JavaScript", "TypeScript", "React", "HTML & CSS", "Browser Internals", "Web Performance",
                    "Frontend State Management")),
            new Category("Other Languages", List.of(
                    "Python", "Go", "Kotlin", "C++", "C# & .NET", "Node.js", "Rust")),
            new Category("Data & AI", List.of(
                    "Machine Learning Fundamentals", "LLMs & Generative AI", "Data Engineering & ETL",
                    "Apache Spark", "Data Modelling & Warehousing")),
            new Category("Behavioural & Leadership", List.of(
                    "Behavioural (STAR)", "Project Deep Dive", "Ownership & Impact", "Conflict Resolution",
                    "Leadership & Mentoring", "Stakeholder Management", "Product Sense", "Agile & Delivery")));

    /** Common shorthand for catalog topics, keyed by {@link #key}. */
    public static final Map<String, String> ALIASES = Map.ofEntries(
            Map.entry("dsa", "Data Structures & Algorithms"),
            Map.entry("datastructures", "Data Structures & Algorithms"),
            Map.entry("algorithms", "Data Structures & Algorithms"),
            Map.entry("dp", "Dynamic Programming"),
            Map.entry("corejava", "Java Core"),
            Map.entry("java", "Java Core"),
            Map.entry("oop", "OOP Principles"),
            Map.entry("oops", "OOP Principles"),
            Map.entry("collections", "Collections Framework"),
            Map.entry("multithreading", "Concurrency & Multithreading"),
            Map.entry("concurrency", "Concurrency & Multithreading"),
            Map.entry("jvm", "JVM Internals & Memory Model"),
            Map.entry("gc", "Garbage Collection & Tuning"),
            Map.entry("streams", "Java Streams & Lambdas"),
            Map.entry("springcore", "Spring Core & Dependency Injection"),
            Map.entry("jpa", "Spring Data JPA & Hibernate"),
            Map.entry("hibernate", "Spring Data JPA & Hibernate"),
            Map.entry("springdata", "Spring Data JPA & Hibernate"),
            Map.entry("webflux", "Spring WebFlux & Reactive"),
            Map.entry("systemdesign", "High-Level System Design"),
            Map.entry("hld", "High-Level System Design"),
            Map.entry("lld", "Low-Level Design"),
            Map.entry("microservices", "Microservices Architecture"),
            Map.entry("messaging", "Messaging & Queues"),
            Map.entry("messagingservices", "Messaging & Queues"),
            Map.entry("messagequeues", "Messaging & Queues"),
            Map.entry("kafka", "Apache Kafka"),
            Map.entry("sql", "SQL & Query Optimisation"),
            Map.entry("nosql", "NoSQL Databases"),
            Map.entry("postgres", "PostgreSQL"),
            Map.entry("gcp", "Google Cloud"),
            Map.entry("k8s", "Kubernetes"),
            Map.entry("cicd", "CI/CD"),
            Map.entry("terraform", "Terraform & IaC"),
            Map.entry("observability", "Observability (Logs, Metrics, Tracing)"),
            Map.entry("os", "Operating Systems"),
            Map.entry("networking", "Computer Networks"),
            Map.entry("dbms", "DBMS Concepts"),
            Map.entry("junit", "Unit Testing (JUnit & Mockito)"),
            Map.entry("unittesting", "Unit Testing (JUnit & Mockito)"),
            Map.entry("tdd", "Test-Driven Development"),
            Map.entry("owasp", "Application Security (OWASP)"),
            Map.entry("oauth", "OAuth2 & JWT"),
            Map.entry("jwt", "OAuth2 & JWT"),
            Map.entry("js", "JavaScript"),
            Map.entry("ts", "TypeScript"),
            Map.entry("golang", "Go"),
            Map.entry("dotnet", "C# & .NET"),
            Map.entry("ml", "Machine Learning Fundamentals"),
            Map.entry("genai", "LLMs & Generative AI"),
            Map.entry("llm", "LLMs & Generative AI"),
            Map.entry("spark", "Apache Spark"),
            Map.entry("behavioural", "Behavioural (STAR)"),
            Map.entry("behavioral", "Behavioural (STAR)"));

    private static final Map<String, String> BY_KEY = new HashMap<>();

    static {
        CATEGORIES.forEach(c -> c.topics().forEach(t -> BY_KEY.put(key(t), t)));
        ALIASES.forEach(BY_KEY::putIfAbsent);
    }

    private TopicCatalog() {
    }

    /**
     * The catalog name for {@code topic} when it matches one (ignoring case, spacing and punctuation, or via a
     * common alias such as "DSA" or "k8s"); otherwise the topic as typed, trimmed with whitespace collapsed.
     */
    public static String canonical(String topic) {
        String cleaned = topic.strip().replaceAll("\\s+", " ");
        return BY_KEY.getOrDefault(key(cleaned), cleaned);
    }

    /** Matching key: lower case, letters and digits only, except '+' and '#' so C++ and C# stay distinct. */
    public static String key(String topic) {
        return topic.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}+#]", "");
    }

    /** Topics a round may focus on: never more than one per main question. */
    public static int maxTopics(int mainQuestions) {
        return Math.max(1, Math.min(MAX_TOPICS, mainQuestions));
    }
}
