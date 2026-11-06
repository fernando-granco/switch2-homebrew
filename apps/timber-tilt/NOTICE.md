# Notices

Timber Tilt game code, board designs, block font and Canvas artwork are MIT licensed; see [LICENSE](LICENSE). It is an original game in the ball-labyrinth genre. It contains no artwork, levels, fonts, audio or code from any other labyrinth game.

The files in `vendor/` are byte-identical copies of libraries from this repository's [Switch Input Test](../input-test/): the input adapter, native touch reader, motion reader/activation helpers, rumble pulse helper and native wrapper, their compatibility profiles, and the report transport. They are pinned in `vendor/manifest.json`. Profiles contain hashes, offsets and minimal instruction masks, not SDK function bodies.

The report transport and USB launcher are built around CivSwitch. CivSwitch is copyright 2026 Gezine, MIT; its notice is retained in [licenses/CivSwitch-MIT.txt](licenses/CivSwitch-MIT.txt).
