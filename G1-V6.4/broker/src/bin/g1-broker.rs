#[path = "../win.rs"]
mod win;

fn main() {
    if let Err(error) = win::service::run() {
        eprintln!("G1_BROKER_FAIL_CLOSED: {error}");
        std::process::exit(1);
    }
}
