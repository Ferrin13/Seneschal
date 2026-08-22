package com.parthadae.seneschal.voice.commands

import com.parthadae.seneschal.voice.ServerVoiceCommander
import com.parthadae.seneschal.voice.VoiceCommandHandler
import com.parthadae.seneschal.voice.VoiceCommandResult
import com.parthadae.seneschal.voice.VoiceUtterance
import javax.inject.Inject
import javax.inject.Singleton

/**
 * LLM fallback for the offline-recognizer path: claims every utterance the
 * fast-path regex handlers passed on (or failed inside) and runs it through
 * the same server tool loop as the primary audio path — just entering with
 * a transcript instead of audio.
 *
 * Network failures come back as transient so the dispatcher can prefer a
 * more specific local failure message when one exists.
 */
@Singleton
class RemoteVoiceHandler @Inject constructor(
    private val commander: ServerVoiceCommander,
) : VoiceCommandHandler {
    override val priority = 90

    // Not listed in help: this handler is an implementation detail, not a
    // grammar of its own.
    override val examples = emptyList<String>()

    override suspend fun handle(utterance: VoiceUtterance): VoiceCommandResult =
        commander.run(ServerVoiceCommander.Input.Transcript(utterance.raw)).result
}
