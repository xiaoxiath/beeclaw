/**
 * LLM-as-Judge prompt templates for skill evaluation.
 *
 * These templates are consumed by FastLLMJudge to assess whether a skill
 * would trigger for a given user message and to rate output quality.
 */

export const TRIGGER_CHECK_PROMPT = `You are an expert judge evaluating whether a skill would be triggered by a user message.

## Skill Under Test
Name: {{skillName}}
Description:
{{skillDescription}}

## User Message
{{userMessage}}

## Task
Determine whether this skill SHOULD be triggered by the user message above.
Consider semantic relevance, intent alignment, and specificity of the match.

## Response Format
Return a JSON object with exactly these fields:
- "triggered": boolean — true if the skill should activate for this message
- "confidence": number — your confidence in the judgment, from 0.0 to 1.0
- "reason": string — a brief explanation of your reasoning

## Examples

User message: "What's the weather in Tokyo?"
Skill: WeatherLookup — Fetches current weather data for a given location.
Response:
\`\`\`json
{"triggered": true, "confidence": 0.95, "reason": "Direct weather query with a specific location matches the skill's purpose exactly."}
\`\`\`

User message: "Translate this paragraph to French."
Skill: WeatherLookup — Fetches current weather data for a given location.
Response:
\`\`\`json
{"triggered": false, "confidence": 0.98, "reason": "Translation request has no semantic overlap with weather data retrieval."}
\`\`\`

User message: "Will I need an umbrella tomorrow in Berlin?"
Skill: WeatherLookup — Fetches current weather data for a given location.
Response:
\`\`\`json
{"triggered": true, "confidence": 0.82, "reason": "Implicit weather query — umbrella need depends on precipitation forecast for a specific location."}
\`\`\`

Now evaluate the skill and user message provided above. Return ONLY the JSON object.`;

export const OUTPUT_QUALITY_PROMPT = `You are an expert judge evaluating the output quality of a skill.

## Skill Content
{{skillContent}}

## User Message
{{userMessage}}

## Expected Behavior
{{expectedBehavior}}

## Evaluation Criteria
{{criteria}}

## Task
Evaluate how well the skill content would handle the user message, considering the
expected behavior and each evaluation criterion listed above.

## Response Format
Return a JSON object with exactly these fields:
- "score": number — overall quality from 0.0 (completely fails) to 1.0 (perfect)
- "strengths": string[] — specific things the skill does well (1-3 items)
- "weaknesses": string[] — specific shortcomings or failure modes (0-3 items)
- "reason": string — a brief summary justifying the score

## Examples

Skill: A markdown-formatting skill that wraps code in fenced blocks.
User message: "Format this Python snippet for me."
Expected behavior: Wrap the code in a Python-fenced code block with syntax highlighting.
Score context: The skill correctly detects the language and wraps the code.
Response:
\`\`\`json
{"score": 0.9, "strengths": ["Correct language detection", "Proper fenced block syntax"], "weaknesses": ["Does not preserve leading indentation"], "reason": "High-quality formatting with minor indentation handling gap."}
\`\`\`

Skill: A summarization skill that extracts key points from articles.
User message: "Summarize this 10-page report."
Expected behavior: Produce a concise 3-5 bullet summary capturing the main findings.
Score context: The skill returns a single vague sentence.
Response:
\`\`\`json
{"score": 0.25, "strengths": ["Produces some output"], "weaknesses": ["Far too brief", "Misses key findings", "No bullet structure"], "reason": "Severely under-delivers on expected summarization depth and structure."}
\`\`\`

Now evaluate the skill content and user message provided above. Return ONLY the JSON object.`;
