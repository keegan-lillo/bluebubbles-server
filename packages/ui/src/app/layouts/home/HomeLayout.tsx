import React from 'react';
import {
    Spacer,
    Box,
    Divider,
    Flex,
    SimpleGrid,
    Stack,
    Text,
    IconButton,
    Popover,
    PopoverCloseButton,
    PopoverContent,
    PopoverHeader,
    PopoverBody,
    PopoverArrow,
    PopoverTrigger,
    UnorderedList,
    ListItem,
    SkeletonText,
    Tooltip
} from '@chakra-ui/react';
import QRCode from 'react-qr-code';
import { AiOutlineInfoCircle, AiOutlineQrcode } from 'react-icons/ai';

import './styles.css';
import { useAppSelector } from '../../hooks';
import { buildQrData, copyToClipboard } from '../../utils/GenericUtils';
import { BiCopy } from 'react-icons/bi';
import { TotalMessagesStatBox, TopGroupStatBox, BestFriendStatBox, DailyMessagesStatBox, TotalPicturesStatBox, TotalVideosStatBox } from 'app/components/stats';


export const HomeLayout = (): JSX.Element => {
    const address = useAppSelector(state => state.config.server_address);
    const fcmClient = useAppSelector(state => state.config.fcm_client);
    const password = useAppSelector(state => state.config.password);
    const port = useAppSelector(state => state.config.socket_port);
    const qrCode: any = fcmClient ? buildQrData(password, address, fcmClient) : null;

    return (
        <Box p={3} borderRadius={10}>
            <Flex flexDirection="column">
                <Stack direction='column' p={5}>
                    <Flex flexDirection='row' justifyContent='flex-start' alignItems='center'>
                        <Text fontSize='2xl'>Connection Details</Text>
                        <Popover trigger='hover'>
                            <PopoverTrigger>
                                <Box ml={2} _hover={{ color: 'brand.primary', cursor: 'pointer' }}>
                                    <AiOutlineInfoCircle />
                                </Box>
                            </PopoverTrigger>
                            <PopoverContent>
                                <PopoverArrow />
                                <PopoverCloseButton />
                                <PopoverHeader>Information</PopoverHeader>
                                <PopoverBody>
                                    <Text>
                                        This page will detail your current connection details. This includes your&nbsp;
                                        server address and your local port.
                                    </Text>
                                    <br />
                                    <UnorderedList>
                                        <ListItem><strong>Server Address:</strong> This is the address that your clients will connect to</ListItem>
                                        <ListItem><strong>Local Port:</strong> This is the port that the HTTP server is running on, 
                                            and the port you will use when port forwarding&nbsp;
                                            for a dynamic DNS
                                        </ListItem>
                                    </UnorderedList>
                                </PopoverBody>
                            </PopoverContent>
                        </Popover>
                    </Flex>
                    <Divider orientation='horizontal' />
                    <Spacer />
                    <Flex flexDirection="row" justifyContent="space-between">
                        <Stack>
                            <Flex flexDirection="row" alignItems='center'>
                                <Text fontSize='md' fontWeight='bold' mr={2}>Server Address: </Text>
                                {(!address) ? (
                                    <SkeletonText noOfLines={1} />
                                ) : (
                                    <Text fontSize='md'>{address}</Text>
                                )}
                                <Tooltip label='Copy Address'>
                                    <IconButton
                                        ml={3}
                                        size='md'
                                        aria-label='Copy Address'
                                        icon={<BiCopy size='22px' />}
                                        onClick={() => copyToClipboard(address)}
                                    />
                                </Tooltip>
                                <Popover placement='bottom' isLazy={true}>
                                    <PopoverTrigger>
                                        <Box ml={2} _hover={{ color: 'brand.primary', cursor: 'pointer' }} >
                                            <Tooltip label='Show QR Code'>
                                                <IconButton
                                                    ml={1}
                                                    size='md'
                                                    aria-label='Show QR Code'
                                                    icon={<AiOutlineQrcode size='24px' />}
                                                />
                                            </Tooltip>
                                        </Box>
                                    </PopoverTrigger>
                                    <PopoverContent>
                                        <PopoverArrow />
                                        <PopoverCloseButton />
                                        <PopoverHeader>QR Code</PopoverHeader>
                                        <PopoverBody>
                                            <Flex justifyContent='center' flexDirection='column' alignItems='center'>
                                                <Text>
                                                    Your QR Code contains your server configuration so that clients can connect.
                                                    Your QR Code should remain <strong>private</strong> as it contains sensitive information!
                                                </Text>
                                                <Box border="5px solid" borderColor='white' mt={4} height='266px' width='266px' borderRadius='lg' mb={3}>
                                                    {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
                                                    {/* @ts-ignore: ts2876 */}
                                                    {(qrCode) ? <QRCode value={qrCode as string} /> : null}
                                                </Box>
                                            </Flex>
                                        </PopoverBody>
                                    </PopoverContent>
                                </Popover>
                            </Flex>
                            <Flex flexDirection="row">
                                <Text fontSize='md' fontWeight='bold' mr={2}>Local Port: </Text>
                                {(!port) ? (
                                    <SkeletonText noOfLines={1} />
                                ) : (
                                    <Text fontSize='md'>{port}</Text>
                                )}
                            </Flex>
                        </Stack>
                        <Divider orientation="vertical" />
                    </Flex>
                </Stack>
                <Stack direction='column' p={5}>
                    <Flex flexDirection='row' justifyContent='flex-start' alignItems='center'>
                        <Text fontSize='2xl'>iMessage Highlights</Text>
                        <Popover trigger='hover'>
                            <PopoverTrigger>
                                <Box ml={2} _hover={{ color: 'brand.primary', cursor: 'pointer' }}>
                                    <AiOutlineInfoCircle />
                                </Box>
                            </PopoverTrigger>
                            <PopoverContent>
                                <PopoverArrow />
                                <PopoverCloseButton />
                                <PopoverHeader>Information</PopoverHeader>
                                <PopoverBody>
                                    <Text>
                                        These are just some fun stats that I included to give you a quick "snapshot"
                                        of your iMessage history on the Mac Device. This does not include messages that
                                        are on Apple's servers, only what is local to this device.
                                    </Text>
                                </PopoverBody>
                            </PopoverContent>
                        </Popover>
                    </Flex>
                    <Divider orientation='horizontal' />
                    <Spacer />
                    { /* Delays are so older systems do not freeze when requesting data from the databases */ }
                    <SimpleGrid columns={3} spacing={5}>
                        <TotalMessagesStatBox />
                        <TopGroupStatBox delay={200} />
                        <BestFriendStatBox delay={400} />
                        <DailyMessagesStatBox delay={600} />
                        <TotalPicturesStatBox delay={800} />
                        <TotalVideosStatBox delay={1000} />
                    </SimpleGrid>
                </Stack>
            </Flex>
        </Box>
    );
};