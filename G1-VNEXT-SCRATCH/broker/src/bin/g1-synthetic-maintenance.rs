#[path = "../import.rs"]
mod import;
#[path = "../import_store.rs"]
mod import_store;
#[path = "../win.rs"]
mod win;

fn main() {
    if std::env::args_os().len() != 1 {
        eprintln!("G1_SYNTHETIC_MAINTENANCE_CLIENT_ERROR: ARGUMENTS_NOT_SUPPORTED");
        std::process::exit(1);
    }
    let args = vec!["synthetic-import".to_owned()];
    match win::pipe::client_command(&args) {
        Ok(response) => {
            println!("{response}");
            if response.contains("\"result\":\"REJECTED\"") {
                std::process::exit(2);
            }
            if response.contains("\"result\":\"INDETERMINATE\"") {
                std::process::exit(3);
            }
        }
        Err(error) => {
            eprintln!("G1_SYNTHETIC_MAINTENANCE_CLIENT_ERROR: {error}");
            std::process::exit(1);
        }
    }
}
