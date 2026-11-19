use play_engine::PlayEngine;
use std::{env, error::Error, process::ExitCode};

fn run() -> Result<(), Box<dyn Error>> {
    let mut args: Vec<_> = env::args().skip(1).collect();
    let details = args.last().is_some_and(|argument| argument == "--details");
    if details {
        args.pop();
    }
    if args.len() < 2 || args.len() > 3 {
        return Err(
            "Использование: play-engine \"Название песни\" \"Исполнитель\" [секунды] [--details]"
                .into(),
        );
    }
    let duration = args
        .get(2)
        .map(|value| value.parse::<u64>())
        .transpose()
        .map_err(|_| "Длительность должна быть целым числом секунд, например 200.")?;
    let result = PlayEngine::new().find(&args[0], &args[1], duration)?;
    if details {
        println!("{}", serde_json::to_string_pretty(&result)?);
    } else {
        println!("{}", result.url);
    }
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
