# Gemini Project Context: Dynamic Discord Voice Channel Bot

## Project Overview

This project is a Python-based Discord bot designed to dynamically manage voice channels on a server. The bot automatically creates and deletes voice channels based on user activity to ensure there is always one empty channel available, without being tied to specific channel or category names.

The core technology is Python using the `discord.py` library. The bot operates on an event-driven architecture, primarily using the `on_voice_state_update` event to trigger its logic.

**Key Functionality:**

*   **Dynamic Channel Creation:** When a user joins a voice channel (e.g., "Game-3") and there are no other empty channels in that same category, the bot automatically creates a new channel ("Game-4").
*   **Dynamic Channel Deletion:** When a user leaves a voice channel and it results in more than one empty channel in the category, the bot deletes the last empty channel.
*   **Primal Channel Protection:** Any channel with a name ending in "-1" (e.g., "Lobby-1") is considered a "primal channel" and will never be deleted by the bot.
*   **Category Agnostic:** The bot's logic is not tied to a specific category name and will work in any category on the server.

## Building and Running

The project uses a Python virtual environment to manage dependencies.

**1. Setup and Installation:**

It is recommended to use a virtual environment to avoid conflicts with system-wide packages.

```bash
# Create a virtual environment
python3 -m venv venv

# Activate the virtual environment
source venv/bin/activate

# Install the required dependencies
pip install -r requirements.txt
```

**2. Running the Bot:**

Before running, you must set your Discord bot token in the `bot.py` file.

```bash
# Run the bot
python bot.py
```

**3. Stopping the Bot:**

To stop the running bot, press `Ctrl + C` in the terminal where it is running.

## Development Conventions

*   **Virtual Environments:** All development and execution should be done within the activated Python virtual environment.
*   **Bot Token:** The bot token is currently hardcoded in `bot.py`. For better security, it is recommended to use an environment variable, as suggested by the commented-out code in the file.
*   **Event-Driven Logic:** The core functionality is handled within the `on_voice_state_update` event handler in `bot.py`.
