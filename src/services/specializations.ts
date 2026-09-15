export type SpecializationDef = {
  label: string;
  keywords: string[];
};

export const SPECIALIZATIONS: Record<string, SpecializationDef> = {
  "architecture": {
    label: "Architecture",
    keywords: [
      "architecture", "architect", "design",
      "structure", "component", "component diagram", "module",
      "module system", "layered", "microservice",
      "monolith", "api gateway", "event-driven", "c4 model",
      "diagram", "sequence diagram", "class diagram",
    ],
  },
  "backend": {
    label: "Backend Development",
    keywords: [
      "backend", "server", "api", "rest api", "graphql",
      "endpoint", "controller", "service", "repository", "database",
      "sql", "query", "migration", "schema",
      "authentication", "authorization", "middleware",
      "routing", "model", "orm", "cache", "queue",
    ],
  },
  "frontend": {
    label: "Frontend Development",
    keywords: [
      "frontend", "ui", "user interface", "component",
      "react", "vue", "angular", "html", "css", "javascript", "typescript",
      "responsive", "accessibility", "a11y",
      "state management", "redux", "hook", "custom hook", "styling",
      "tailwind", "animation", "routing", "navigation",
    ],
  },
  "security": {
    label: "Cybersecurity",
    keywords: [
      "security", "secure", "vulnerability",
      "exploit", "authentication", "authorization",
      "encryption", "aes", "rsa", "hash",
      "xss", "csrf", "sql injection", "injection", "owasp",
      "cve", "rbac", "acl", "permission", "token", "jwt",
      "oauth", "zero trust", "audit", "compliance",
    ],
  },
  "testing": {
    label: "Testing",
    keywords: [
      "test", "testing", "unit test",
      "integration test", "e2e", "end to end",
      "mocking", "jest", "vitest", "pytest", "junit",
      "tdd", "bdd", "coverage", "assertion",
      "snapshot", "performance test", "load test",
      "regression", "qa", "quality",
    ],
  },
  "devops": {
    label: "DevOps",
    keywords: [
      "devops", "ci/cd", "pipeline", "deployment",
      "docker", "container", "kubernetes", "k8s", "helm",
      "ansible", "terraform", "infrastructure", "iac",
      "monitoring", "grafana", "prometheus", "logging",
      "alert", "github actions", "gitlab ci",
      "jenkins", "release", "rollback",
    ],
  },
  "data": {
    label: "Data and Analytics",
    keywords: [
      "data", "analytics", "ml", "machine learning",
      "ai", "deep learning",
      "model training", "dataset", "feature",
      "pipeline data", "etl", "elt", "warehouse",
      "big data", "spark", "hadoop", "streaming",
      "kafka", "airflow", "dbt", "lake",
    ],
  },
  "documentation": {
    label: "Documentation",
    keywords: [
      "documentation", "docs", "readme", "wiki", "guide",
      "api doc", "swagger", "openapi", "jsdoc", "typedoc",
      "changelog", "contributing",
      "architecture decision", "adr", "specification",
      "technical writing", "markdown",
    ],
  },
  "performance": {
    label: "Performance and Optimization",
    keywords: [
      "performance", "optimization", "bottleneck",
      "latency", "throughput",
      "profiling", "memory leak", "n+1",
      "query optimization", "index",
      "caching", "lazy loading",
      "code splitting", "tree shaking", "bundling",
    ],
  },
  "refactoring": {
    label: "Refactoring",
    keywords: [
      "refactor", "refactoring", "clean code",
      "code smell", "technical debt",
      "legacy", "migration", "modernize",
      "extract", "inline", "rename",
      "simplify", "duplicate", "dead code",
      "complexity", "solid", "design pattern",
    ],
  },
  "review": {
    label: "Code Review",
    keywords: [
      "review", "code review", "pr", "pull request",
      "feedback", "approve",
      "changes requested", "comment",
      "nitpick", "lgtm", "best practice",
      "convention", "style guide",
    ],
  },
};