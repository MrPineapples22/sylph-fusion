#[cfg(feature = "synthetic-maintenance")]
#[path = "../import.rs"]
mod import;
#[cfg(feature = "synthetic-maintenance")]
#[path = "../import_store.rs"]
mod import_store;
#[path = "../win.rs"]
mod win;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match win::pipe::client_command(&args) {
        Ok(response) => {
            println!("{response}");
            if response.starts_with("ERR|") {
                std::process::exit(2);
            }
            if response.contains("\"authority\":\"SYNTHETIC_TEST_ONLY\"") {
                if response.contains("\"result\":\"REJECTED\"") {
                    std::process::exit(2);
                }
                if response.contains("\"result\":\"INDETERMINATE\"") {
                    std::process::exit(3);
                }
            }
        }
        Err(error) => {
            eprintln!("IPC_ERROR: {error}");
            std::process::exit(1);
        }
    }
}
