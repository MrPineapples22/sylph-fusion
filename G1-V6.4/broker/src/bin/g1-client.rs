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
        }
        Err(error) => {
            eprintln!("IPC_ERROR: {error}");
            std::process::exit(1);
        }
    }
}
