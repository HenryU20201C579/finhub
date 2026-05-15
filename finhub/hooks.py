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
		"label": "Caja Chica",
		"url": "/caja_chica",
		"icon": "wallet",
		"role": "Finhub-Caja-Ver",
	},
	{
		"label": "Gastos Distribución",
		"url": "/gastos_distribucion",
		"icon": "truck",
		"role": "Finhub-Finanzas-Ver",
	},
	{
		"label": "Prorrateo de Ventas",
		"url": "/prorrateo_ventas",
		"icon": "calculator",
		"role": "Finhub-Finanzas-Ver",
	},
	{
		"label": "Estado de Resultados",
		"url": "/estado_resultados",
		"icon": "trending-up",
		"role": "Finhub-Finanzas-Ver",
	},
	{
		"label": "Finanzas Corporativas",
		"url": "/finanzas_corporativas",
		"icon": "landmark",
		"role": "Finhub-Finanzas-Ver",
	},
]

fixtures = [
	{"dt": "Role", "filters": [["role_name", "like", "Finhub-%"]]},
]
