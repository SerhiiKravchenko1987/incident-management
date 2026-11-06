import cds from '@sap/cds'

export class ProcessorService extends cds.ApplicationService {

    async init() {
        this.before("UPDATE", "Incidents", (req) => this.onUpdate(req))
        this.before(["CREATE", "UPDATE"], "Incidents", (req) => this.changeUrgencyDueToSubject(req.data))

        // Підключення до зовнішнього сервісу SAP Business Partner
        const bupa = await cds.connect.to('API_BUSINESS_PARTNER')

        // Делегування READ-запитів для сутності BusinessPartners безпосередньо у зовнішню систему
        this.on('READ', 'BusinessPartners', async (req) => {
            return bupa.run(req.query)
        })

        // Ефективне доповнення інцидентів назвами бізнес-партнерів (пакетна обробка)
        this.after('READ', 'Incidents', async (each) => {
            const incidents = Array.isArray(each) ? each : [each]
            
            // 1. Збираємо унікальні ID локальних клієнтів з отриманих інцидентів
            const customerIds = incidents
                .map(inc => inc.customer?.ID || inc.customer_ID)
                .filter(Boolean)

            if (customerIds.length === 0) return

            try {
                // 2. Отримуємо клієнтів із локальної БД одним запитом
                const customers = await SELECT.from('sap.capire.incidents.Customers')
                    .where({ ID: customerIds })
                    .columns('ID', 'businessPartner')

                const customerMap = new Map(customers.map(c => [c.ID, c.businessPartner]))
                const bpIds = [...new Set(customers.map(c => c.businessPartner).filter(Boolean))]

                if (bpIds.length === 0) return

                // 3. Виконуємо єдиний пакетний запит до SAP Sandbox замість циклу
                const remotePartners = await bupa.run(
                    SELECT.from(bupa.entities.A_BusinessPartner)
                        .where({ BusinessPartner: bpIds })
                        .columns('BusinessPartner', 'BusinessPartnerFullName')
                )

                const bpNameMap = new Map(remotePartners.map(bp => [bp.BusinessPartner, bp.BusinessPartnerFullName]))

                // 4. Проставляємо імена у результати інцидентів
                for (const incident of incidents) {
                    const custId = incident.customer?.ID || incident.customer_ID
                    const bpId = customerMap.get(custId)
                    
                    if (bpId && bpNameMap.has(bpId)) {
                        incident.businessPartnerName = bpNameMap.get(bpId)
                    } else {
                        incident.businessPartnerName = bpId ? `${bpId} (No remote data)` : 'No customer assigned'
                    }
                }
            } catch (error) {
                console.error('Error enriching incidents with Business Partners:', error.message)
                incidents.forEach(inc => {
                    inc.businessPartnerName = 'SAP connection error'
                })
            }
        })

        return super.init()
    }

    // Автоматично встановлюємо високу терміновість, якщо в заголовку є слово urgent
    changeUrgencyDueToSubject(data) {
        const urgent = data.title?.match(/urgent/i)
        if (urgent) {
            data.urgency_code = 'H'
        }
    }

    // Забороняємо змінювати закриті інциденти
    async onUpdate(req) {
        const closed = await SELECT.one(1)
            .from(req.subject)
            .where`status.code = 'C'`

        if (closed) {
            req.reject("Can't modify a closed incident!")
        }
    }
}