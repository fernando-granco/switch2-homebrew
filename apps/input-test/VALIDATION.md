# Validation scope

## Hardware

v1.1.0 was tested on Switch 2: all 16 gameplay-button cycles, both stick axes/neutral, ten native contacts with independent lift, all touch targets, raw motion, and Left/Right/Both rumble. The solid letters, one-based labels, Motion-page controls and responsiveness were confirmed. Normal user exit completed with no reported errors/warnings and every cleanup check passing.

Earlier Switch 1 tests established buttons, sticks, ten-contact touch and raw motion. Switch 1 rumble and v1.1.0 letter appearance on Switch 1 remain untested. Other SDK/controller configurations are not established by these results. Runtime fingerprints refuse mismatches.

## Offline

Tests cover models, stable one-based labels without rewriting native IDs, opaque outline text with native text/gradient APIs forbidden, release-triggered rumble, controller-only fallback, disabled/changed/error services, Reset/cancel/exit cleanup, bounded histories, fragmented report integrity and serial bridge framing. Additional development-time instruction-fixture checks covered native compatibility guards; private fixtures and captured reports are not distributed.

Hardware validation covers normal exit. Reset/interrupted-pulse/failure paths are covered offline rather than claimed as separate hardware experiments. Motion axes/units are uncalibrated, controller product identity is unqueried, and responsiveness is an observation rather than a measured frame rate. Successful rumble sends are not measurements of perceived motor output. Evicted records cannot be individually audited from a bounded report.
