app_name = "finhub"
app_title = "FinHub"
app_publisher = "Henry Diaz"
app_description = "Hub de finanzas, caja chica, contabilidad y reportes financieros para el ecosistema Tiranidos"
app_email = "henrytiranidos@gmail.com"
app_license = "mit"

required_apps = ["erpnext"]

# Tiles que se mostrarán en el sidebar del launcher.
# Vacío por ahora: el hub se registra como visible vía launcher_show_empty
# para que aparezca como sección desplegable sin sub-páginas todavía.
launcher_tiles = []

# Hace que el launcher renderice este hub como grupo aunque no tenga tiles.
launcher_show_empty = 1

fixtures = [
	{"dt": "Role", "filters": [["role_name", "like", "Finhub-%"]]},
]
