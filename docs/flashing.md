# Flashing QuireOS onto the LilyGo T5 E-Paper S3 Pro

Everything runs from `firmware/` with [PlatformIO](https://platformio.org). The board is the
**T5 E-Paper S3 Pro** (ESP32-S3, 16 MB flash, 8 MB PSRAM, 4.7" 960x540 panel). Other LilyGo T5
variants have a different pin map and will not work with this build.

## 1. Install PlatformIO

With [uv](https://docs.astral.sh/uv/):

```sh
uv tool install platformio      # installs `pio` into ~/.local/bin
pio --version
```

or in a virtualenv: `uv venv && source .venv/bin/activate && uv pip install platformio`.

The first build downloads the `espressif32@6.12.0` platform, the Arduino core and the Xtensa
toolchain (about 1 GB, one time).

## 2. First flash over USB

1. Connect the board with a USB-C **data** cable. It enumerates as a serial port
   (`/dev/cu.usbmodem*` on macOS).
2. Build and upload:

   ```sh
   cd firmware
   pio run -e t5pro -t upload
   ```

   PlatformIO finds the port itself; add `--upload-port /dev/cu.usbmodemXXXX` if you have several.

3. Open the serial monitor (the firmware logs over the USB CDC port at 115200 baud):

   ```sh
   pio device monitor
   ```

### Download mode

The ESP32-S3 normally resets into the bootloader on its own when esptool asks. If the upload stalls
with `Connecting........____` or the port never appears (a crashing firmware, or the USB CDC stack
is not up), force download mode:

1. Hold **BOOT** (the small button next to the USB port).
2. Tap **RST** (the button on the back) while holding BOOT.
3. Release **BOOT**. The board now shows up as a plain serial port that esptool can talk to.
4. Run the upload again, then tap RST once more to start the new firmware.

## 3. Updates over Wi-Fi (OTA)

Once QuireOS is on Wi-Fi it announces itself as `quireos.local` (mDNS) and accepts ArduinoOTA
uploads:

```sh
pio run -e t5pro-ota -t upload
```

The env uses `upload_port = quireos.local`; pass `--upload-port <ip>` if mDNS does not resolve on
your network. The device saves the current screen image before it reboots, so the panel does not
flash after an update.

## 4. Board-layer probe

`pio run -e probe -t upload` flashes a small test firmware that draws a grey ramp and a grid,
inverts a square under each tap, and prints touch / button events, battery, RTC time and free memory
to the serial monitor. It links only the board layer, so it is the first thing to run on a new board
or after a change under `src/boards/t5pro/`. See `spec/NOTES-t5pro.md` for what to check.

## 5. Restoring LilyGo's factory firmware

LilyGo publishes a full flash image in their repository
([Xinyuan-LilyGO/T5S3-4.7-e-paper-PRO](https://github.com/Xinyuan-LilyGO/T5S3-4.7-e-paper-PRO),
`firmware/T5_E_PAPER_S3_PRO_V1.0_20260506.bin` or a newer file). It is a merged image that goes
at offset `0x0`:

```sh
cd firmware
uv tool install esptool          # or: pio pkg exec -p tool-esptoolpy -- esptool.py ...
esptool.py --chip esp32s3 --port /dev/cu.usbmodemXXXX --baud 921600 \
  write_flash --flash_mode dio --flash_size 16MB 0x0 T5_E_PAPER_S3_PRO_V1.0_20260506.bin
```

If the port does not answer, enter download mode as above. `esptool.py --chip esp32s3 erase_flash`
first if you want to drop QuireOS's settings and files as well (they live in the `nvs` and `spiffs`
partitions).

## 6. Serial monitor tips

- `pio device monitor` uses the `monitor_filters` from `platformio.ini` (exception decoder and
  timestamps). `pio device monitor --raw` turns them off.
- The USB CDC port disappears while the chip is in download mode or deep sleep and comes back on
  boot; the monitor reconnects on its own.
- Log lines look like `[   12345] I net: wifi connected (...)`, level `E`/`W`/`I`/`D`. The probe
  prefixes its own output with `[probe]`.
