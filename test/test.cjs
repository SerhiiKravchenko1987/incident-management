const cds = require('@sap/cds')
const test = cds.test(__dirname + '/..', '--with-mocks')
const { GET, POST, DELETE, PATCH, expect } = test

test.defaults.auth = { username: 'alice', password: '' }

describe('Test The GET Endpoints', () => {
  it('Should check Processor Service', async () => {
    const processorService = await cds.connect.to('ProcessorService')
    const { Incidents } = processorService.entities
    expect(await SELECT.from(Incidents)).to.have.length(4)
  })

  it('Should check Customers', async () => {
    const processorService = await cds.connect.to('ProcessorService')
    const { Customers } = processorService.entities
    expect(await SELECT.from(Customers)).to.have.length(3)
  })

  it('Test Expand Entity Endpoint', async () => {
    const { data } = await GET(`/odata/v4/admin/Customers?$select=firstName&$expand=incidents`, { auth: { username: 'bob', password: '' } })
    expect(data).to.be.an('object')
    expect(data.value).to.be.an('array')
  })
})

describe('Draft Choreography APIs', () => {
  let draftId, incidentId

  it('Create an incident ', async () => {
    const { status, data } = await POST(`/odata/v4/processor/Incidents`, {
      title: 'Urgent attention required !',
      status_code: 'N'
    })
    draftId = data.ID
    expect(status).to.equal(201)
    expect(data.IsActiveEntity).to.equal(false)
  })

  it('+ Activate the draft & check Urgency code as H using custom logic', async () => {
    const { status, data } = await POST(
      `/odata/v4/processor/Incidents(ID=${draftId},IsActiveEntity=false)/ProcessorService.draftActivate`
    )
    expect(status).to.eql(201)
    expect(data.urgency_code).to.eql('H')
    expect(data.IsActiveEntity).to.equal(true)
  })

  it('+ Test the incident status', async () => {
    const { status, data: { status_code, ID } } = await GET(
      `/odata/v4/processor/Incidents(ID=${draftId},IsActiveEntity=true)`
    )
    incidentId = ID
    expect(status).to.eql(200)
    expect(status_code).to.eql('N')
  })

  describe('Close Incident and Open it again to check Custom logic', () => {
    it('Should Close the Incident', async () => {
      const { status } = await POST(
        `/odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=true)/ProcessorService.draftEdit`,
        { PreserveChanges: true }
      )
      expect(status).to.equal(201)
    })

    it('Should patch the Incident status to Closed', async () => {
      const { status } = await PATCH(
        `/odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=false)`,
        { status_code: 'C' }
      )
      expect(status).to.equal(200)
    })

    it('+ Activate the draft & check Status code as C using custom logic', async () => {
      const { status, data } = await POST(
        `/odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=false)/ProcessorService.draftActivate`
      )
      expect(status).to.eql(200)
      expect(data.status_code).to.eql('C')
    })

    it('+ Test the incident status to be closed', async () => {
      const { status, data: { status_code } } = await GET(
        `/odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=true)`
      )
      expect(status).to.eql(200)
      expect(status_code).to.eql('C')
    })

    describe('should fail to re-open closed incident', () => {
      it('Should Open Closed Incident', async () => {
        const { status } = await POST(
          `/odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=true)/ProcessorService.draftEdit`,
          { PreserveChanges: true }
        )
        expect(status).to.equal(201)
      })

      it('Should re-open the Incident but fail', async () => {
        const { status } = await PATCH(
          `/odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=false)`,
          { status_code: 'N' }
        )
        expect(status).to.equal(200)
      })

      it('Should fail to activate draft trying to re-open the incident', async () => {
        const { status, data } = await POST(
          `/odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=false)/ProcessorService.draftActivate`,
          {},
          { validateStatus: null }
        )
        expect(status).to.eql(500)
        expect(data.error.message).to.include(`Can't modify a closed incident`)
      })
    })
  })

  it('- Delete the Draft', async () => {
    const { status } = await DELETE(
      `/odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=false)`
    )
    expect(status).to.eql(204)
  })

  it('- Delete the Incident', async () => {
    const { status } = await DELETE(
      `/odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=true)`
    )
    expect(status).to.eql(204)
  })
})

describe('Auto-Urgency logic (processor-service.js custom handler)', () => {
  const activate = async (body) => {
    const { data: draft } = await POST(`/odata/v4/processor/Incidents`, body)
    const { data: active } = await POST(
      `/odata/v4/processor/Incidents(ID=${draft.ID},IsActiveEntity=false)/ProcessorService.draftActivate`
    )
    return active
  }
  const cleanup = async (id) => {
    await DELETE(`/odata/v4/processor/Incidents(ID=${id},IsActiveEntity=true)`, { validateStatus: null })
  }

  it('does NOT change urgency_code when title has no "urgent"', async () => {
    const active = await activate({ title: 'Routine maintenance', urgency_code: 'L', status_code: 'N' })
    expect(active.urgency_code).to.equal('L')
    await cleanup(active.ID)
  })

  it('sets urgency_code=H for all-caps URGENT (case-insensitive /urgent/i)', async () => {
    const active = await activate({ title: 'URGENT: system failure', urgency_code: 'L', status_code: 'N' })
    expect(active.urgency_code).to.equal('H')
    await cleanup(active.ID)
  })

  it('sets urgency_code=H when "urgent" appears mid-title', async () => {
    const active = await activate({ title: 'Please treat this as urgent matter', urgency_code: 'M', status_code: 'N' })
    expect(active.urgency_code).to.equal('H')
    await cleanup(active.ID)
  })
})

describe('Authorization', () => {
  it('rejects support-role user (alice) from AdminService with 403', async () => {
    const { status } = await GET(`/odata/v4/admin/Customers`, { validateStatus: null })
    expect(status).to.equal(403)
  })

  it('allows bob (admin role) to read and write Customers', async () => {
    const bob = { auth: { username: 'bob', password: '' } }

    const { status: gs, data } = await GET(`/odata/v4/admin/Customers`, bob)
    expect(gs).to.equal(200)
    expect(data.value).to.be.an('array')

    const { status: cs } = await POST(
      `/odata/v4/admin/Customers`,
      { ID: 'AUTH01', firstName: 'Test', lastName: 'Admin' },
      bob
    )
    expect(cs).to.equal(201)

    const { status: ds } = await DELETE(`/odata/v4/admin/Customers('AUTH01')`, { ...bob, validateStatus: null })
    expect(ds).to.equal(204)
  })
})
