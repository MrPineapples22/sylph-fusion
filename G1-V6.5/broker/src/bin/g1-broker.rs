#[path = "../win.rs"]
mod win;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let [operation, path] = args.as_slice() {
        if operation == "--initialize-synthetic-authority" {
            match win::sqlite::Registry::initialize(std::path::Path::new(path)) {
                Ok(registry) => {
                    println!("{{\"schema\":\"SYLPH_G1_SYNTHETIC_BOOTSTRAP_1\",\"status\":\"SYNTHETIC_TEST_ONLY\",\"sqliteVersion\":\"{}\",\"sqliteSourceId\":\"{}\"}}", registry.version, registry.sourceid);
                    return;
                }
                Err(error) => {
                    eprintln!("G1_BROKER_INIT_FAIL_CLOSED: {error}");
                    std::process::exit(2);
                }
            }
        }
    }
    if let Err(error) = win::service::run() {
        eprintln!("G1_BROKER_FAIL_CLOSED: {error}");
        std::process::exit(1);
    }
}

