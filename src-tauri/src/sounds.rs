#[cfg(target_os = "macos")]
pub fn play_sound(sound_name: &str) {
    use std::{process::Command, thread};
    let sound_path = format!("/System/Library/Sounds/{sound_name}.aiff");
    thread::spawn(move || {
        let _ = Command::new("/usr/bin/afplay").arg(sound_path).status();
    });
}

#[cfg(not(target_os = "macos"))]
pub fn play_sound(sound_name: &str) {
    use rodio::source::{SineWave, Source};
    use rodio::{OutputStream, Sink};
    use std::thread;
    use std::time::Duration;

    let freq = match sound_name {
        "Basso" => 180.0,
        "Blow" => 520.0,
        "Bottle" => 880.0,
        "Frog" => 350.0,
        "Funk" => 660.0,
        "Glass" => 1200.0,
        "Hero" => 440.0,
        "Morse" => 800.0,
        "Ping" => 1400.0,
        "Pop" => 600.0,
        "Purr" => 280.0,
        "Sosumi" => 1000.0,
        "Submarine" => 220.0,
        "Tink" => 1600.0,
        _ => 440.0,
    };

    thread::spawn(move || {
        if let Ok((_stream, stream_handle)) = OutputStream::try_default() {
            if let Ok(sink) = Sink::try_new(&stream_handle) {
                let source = SineWave::new(freq)
                    .take_duration(Duration::from_millis(600))
                    .amplify(0.25);
                sink.append(source);
                sink.sleep_until_end();
            }
        }
    });
}
