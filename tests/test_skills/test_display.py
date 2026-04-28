from openharness.skills.display import display_skill_description, translate_skill_description
from openharness.skills.types import SkillDefinition


def test_known_skill_description_is_translated_for_display():
    skill = SkillDefinition(
        name="skill-creator",
        description=(
            "Guide for creating effective skills. This skill should be used when users want to create a new skill "
            "(or update an existing skill) that extends Codex's capabilities with specialized knowledge, workflows, "
            "or tool integrations."
        ),
        content="# skill-creator\n",
        source="project",
    )

    assert display_skill_description(skill).startswith("효과적인 스킬을 만들거나")
    assert skill.description.startswith("Guide for creating effective skills.")


def test_unmapped_skill_description_stays_original():
    description = "Use this brand-new imported workflow exactly as written."

    assert translate_skill_description("new-imported-skill", description) == description
