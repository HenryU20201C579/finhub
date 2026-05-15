app_name = "finhub"
app_title = "FinHub"
app_publisher = "Henry Diaz"
app_description = "Hub de finanzas, caja chica, contabilidad y reportes financieros para el ecosistema Tiranidos"
app_email = "henrytiranidos@gmail.com"
app_license = "mit"

required_apps = ["erpnext"]

# Tiles que se mostrarán en el sidebar del launcher.
launcher_tiles = [
	{
		"label": "Prorrateo de Ventas",
		"url": "/prorrateo_ventas",
		"icon": "calculator",
		"role": "Finhub-Finanzas-Ver",
	},
]

fixtures = [
	{"dt": "Role", "filters": [["role_name", "like", "Finhub-%"]]},
]
