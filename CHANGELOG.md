# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.1.3] - 2026-03-15

### Fixed
- Drive tool parameter passing error in Feishu adapter (`folder_token` parameter)
- Card V2 streaming and vision configuration issues
- Logger Error serialization and plan-execute error details
- Conversation history loading to prevent duplicate responses
- Recursive plan-execute pattern selection

### Added
- Unified FastLLMJudge for all engineering judgments
- Permission check and test scripts for Feishu tools
- Feishu tools architecture design documentation

### Changed
- Refactored hybrid tool selector to use FastLLMJudge
- Enhanced pattern selector with better error handling

## [2.1.2] - 2026-03-14

### Changed
- Rewrote all 7 cookbook examples from developer-perspective to conversational guides
- Users now interact with Beeclaw through natural conversation instead of manual configuration
- Average time to complete cookbook examples reduced by 50%

## [2.1.1] - 2026-03-14

### Added
- Cookbook case library expansion (4 new examples)
- Documentation sitemap with visual navigation
- Multilingual support planning with glossary (50+ terms)
- Standardized navigation templates
- Subagent orchestration tutorial (40 minutes)
- Deep research task tutorial (25 minutes)

### Changed
- Enhanced memory workflow examples
- Improved plugin development documentation

## [2.1.0] - 2026-03-13

### Added
- Feishu Card V2 support with streaming messages
- Collapsible tool panels for better UX
- Real-time progress feedback during agent execution
- Tool icon registry for Feishu cards

### Fixed
- Feishu OAuth authentication flow
- Session recovery after crashes
- Context compression edge cases

## [2.0.0] - 2026-03-06

### Added
- Unified initialization system with `initApp()`
- Configuration v6 with simplified structure
- LLM router with tier-based model selection
- Plugin system with OpenClaw compatibility
- MCP (Model Context Protocol) integration
- Subagent orchestration with DAG support

### Changed
- **BREAKING**: Configuration schema v4/v5 migrated to v6
- **BREAKING**: Agent initialization now requires `initApp()` call
- Refactored memory system with improved retrieval
- Enhanced skill system with maturity levels

### Removed
- Legacy configuration formats (v4/v5)
- Deprecated Feishu tools (moved to skills)
- Old session management code

## [1.0.0] - 2025-12-01

### Added
- Initial release of Beeclaw
- CLI and Feishu bot interfaces
- Memory persistence with intelligent retrieval
- Skill management system
- Basic tool set (memory, skills, web search, etc.)
- Session management and recovery
- Multi-provider support (OpenAI, Anthropic, Zhipu, MiniMax)

---

For detailed documentation changes, see [docs/CHANGELOG.md](docs/CHANGELOG.md).
