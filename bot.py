
import discord
import os

intents = discord.Intents.default()
intents.voice_states = True
intents.guilds = True

client = discord.Client(intents=intents)




@client.event
async def on_ready():
    print(f'We have logged in as {client.user}')

@client.event
async def on_voice_state_update(member, before, after):
    # Determine the category from the channel that was left or joined
    category = None
    if after.channel:
        category = after.channel.category
    elif before.channel:
        category = before.channel.category

    if not category:
        # The channel is not in a category, so we do nothing
        return

    # Get all voice channels in the category
    voice_channels = category.voice_channels
    voice_channels.sort(key=lambda c: c.name)

    # --- Channel Creation Logic ---
    if after.channel and after.channel.category == category:
        empty_channels = [ch for ch in voice_channels if len(ch.members) == 0]
        if not empty_channels:
            # No empty channels left, create a new one based on the joined channel's name
            triggering_channel = after.channel
            base_name_parts = triggering_channel.name.rsplit('-', 1)
            base_name = base_name_parts[0] if len(base_name_parts) > 1 else triggering_channel.name

            # Count channels with the same base name to determine the new channel number
            related_channels = [ch for ch in voice_channels if ch.name.startswith(f"{base_name}-")]
            new_channel_number = len(related_channels) + 1
            new_channel_name = f"{base_name}-{new_channel_number}"
            
            await category.create_voice_channel(new_channel_name)
            print(f"Created new channel: {new_channel_name}")

    # --- Channel Deletion Logic ---
    if before.channel and before.channel.category == category:
        # Get empty channels again after a member has left
        empty_channels = [ch for ch in category.voice_channels if len(ch.members) == 0]
        
        # We only want to act if there's more than one empty channel
        if len(empty_channels) > 1:
            # Get the channels to consider for deletion (all that don't end with -1)
            deletable_empty_channels = [ch for ch in empty_channels if not ch.name.endswith("-1")]
            deletable_empty_channels.sort(key=lambda c: c.name, reverse=True)

            if deletable_empty_channels:
                channel_to_delete = deletable_empty_channels[0]
                await channel_to_delete.delete()
                print(f"Deleted empty channel: {channel_to_delete.name}")

# It is recommended to use an environment variable for your token
# client.run(os.environ.get("DISCORD_BOT_TOKEN"))
client.run("MTQzNDg2NDgyMzUzMDk1MDc0OQ.GQOlV1.yKoIo3oSzG5PiRBB1sS-31jq4i7cPLT-nNv2ZU") # Replace with your bot's token
