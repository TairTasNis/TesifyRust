use tesify_lib::{
    preview::routes,
    shared::{config::Config, services::AppServices},
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let services = AppServices::new(Config::load()?)?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:17830").await?;
    println!("Tesify preview backend: http://127.0.0.1:17830");
    axum::serve(listener, routes::router(services)).await?;
    Ok(())
}
