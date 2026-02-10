plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.1.0"
    id("org.jetbrains.intellij.platform") version "2.11.0"
}

group = "com.pide"
version = "0.1.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2025.1")
    }
}

// Require Java 21 for build
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

kotlin {
    jvmToolchain(21)
}

tasks {
    withType<JavaCompile> {
        sourceCompatibility = "21"
        targetCompatibility = "21"
    }
    withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
        }
    }
}

intellijPlatform {
    pluginConfiguration {
        id = "com.pide.jetbrains"
        name = "Pi IDE Integration"
        version = "0.1.0"
        description = """
            Sends current file and selection to pi coding agent.
            When you select code or open a file, the selection is sent to pi where you can
            reference it with Ctrl+I.
        """.trimIndent()
        vendor {
            name = "pide"
        }
        ideaVersion {
            sinceBuild = "251"
            untilBuild = "261.*"
        }
    }

    pluginVerification {
        ides {
            recommended()
        }
    }
}
