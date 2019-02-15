const { i18nFactory, directionsHttpFactory } = require('../factories')
const { message, logger, translation, directions, slot } = require('../utils')
const commonHandler = require('./common')
const {
    SLOT_CONFIDENCE_THRESHOLD,
    INTENT_FILTER_PROBABILITY_THRESHOLD
} = require('../constants')

module.exports = async function (msg, flow, knownSlots = { depth: 2 }) {
    const i18n = i18nFactory.get()

    logger.info('GetDepartureTime')

    // Extracting slots
    const {
        locationFrom,
        locationTo,
        travelMode
    } = await commonHandler(msg, knownSlots)

    // Get arrival_time specific slot
    let arrivalTime
    if (!('arrival_time' in knownSlots)) {
        const arrivalTimeSlot = message.getSlotsByName(msg, 'arrival_time', {
            onlyMostConfident: true,
            threshold: SLOT_CONFIDENCE_THRESHOLD
        })

        if (arrivalTimeSlot) {
            const arrivalTimeDate = new Date(arrivalTimeSlot.value.value.value)
            arrivalTime = arrivalTimeDate.getTime() / 1000

            logger.info('\tarrival_time: ', arrivalTimeDate)
        }
    } else {
        arrivalTime = knownSlots.arrival_time
    }

    // One or two required slots are missing
    if (slot.missing(locationTo) || slot.missing(arrivalTime)) {
        if (knownSlots.depth === 0) {
            throw new Error('slotsNotRecognized')
        }

        flow.continue('snips-assistant:GetDepartureTime', (msg, flow) => {
            if (msg.intent.probability < INTENT_FILTER_PROBABILITY_THRESHOLD) {
                throw new Error('intentNotRecognized')
            }

            let slotsToBeSent = {
                location_from: locationFrom,
                travel_mode: travelMode,
                depth: knownSlots.depth - 1
            }

            // Adding the known slots, if more
            if (!slot.missing(locationTo)) {
                slotsToBeSent.location_to = locationTo
            }
            if (!slot.missing(arrivalTime)) {
                slotsToBeSent.arrival_time = arrivalTime
            }

            return require('./index').getDepartureTime(msg, flow, slotsToBeSent)
        })

        flow.continue('snips-assistant:Cancel', (_, flow) => {
            flow.end()
        })
        flow.continue('snips-assistant:Stop', (_, flow) => {
            flow.end()
        })
        
        if (slot.missing(locationTo) && slot.missing(arrivalTime)) {
            return i18n('directions.dialog.noDestinationAddressAndArrivalTime')
        }
        if (slot.missing(locationTo)) {
            return i18n('directions.dialog.noDestinationAddress')
        }
        if (slot.missing(arrivalTime)) {
            return i18n('directions.dialog.noArrivalTime')
        }
    } else {
        // Are the origin and destination addresses the same?
        if (locationFrom.includes(locationTo) || locationTo.includes(locationFrom)) {
            const speech = i18n('directions.dialog.sameLocations')
            flow.end()
            logger.info(speech)
            return speech
        }

        // Get the data from Directions API
        const directionsData = await directionsHttpFactory.calculateRoute({
            origin: locationFrom,
            destination: locationTo,
            travelMode: travelMode,
            arrivalTime: arrivalTime
        })
        logger.debug(directionsData)

        const aggregatedDirectionsData = directions.aggregateDirections(directionsData)
        //logger.debug(aggregatedDirectionsData)

        let speech = ''
        try {
            const destination = directionsData.routes[0].legs[0].end_address
            const departureTime = directionsData.routes[0].legs[0].departure_time.value
            const arrivalTime = directionsData.routes[0].legs[0].arrival_time.value

            speech = translation.departureTimeToSpeech(locationFrom, destination, travelMode, departureTime, arrivalTime, aggregatedDirectionsData)
        } catch (error) {
            logger.error(error)
            throw new Error('APIResponse')
        }
    
        flow.end()
        logger.info(speech)
        return speech
    }
}
